const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 🛡️ SECURITY LAYER 1: API KEY MIDDLEWARE
// ==========================================
const API_KEY = "sukanplay-secret-key-2026"; // Ganti dengan password rahasiamu saat deployment!

const authenticate = (req, res, next) => {
    // Kita lindungi jalur POST, PUT, dan DELETE (Write/Edit). 
    // Jalur GET (Read) dibiarkan publik agar Dashboard mudah diakses.
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const clientKey = req.headers['x-api-key'];
        if (!clientKey || clientKey !== API_KEY) {
            console.warn(`[SECURITY WARN] Akses ditolak dari IP: ${req.ip}`);
            return res.status(403).json({ error: "Akses Ditolak: API Key tidak valid!" });
        }
    }
    next(); // Kunci benar, silakan lewat
};

// Pasang satpam di semua rute
app.use(authenticate);

// ==========================================
// 🛡️ SECURITY LAYER 2: INPUT VALIDATOR HELPER
// ==========================================
const validateInput = (requiredFields, body) => {
    for (let field of requiredFields) {
        if (body[field] === undefined || body[field] === null || body[field] === '') {
            return `Data ditolak: Field '${field}' wajib diisi!`;
        }
    }
    return null;
};


// ==========================================
// KONFIGURASI DATABASE (CONNECTION POOL)
// ==========================================
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',      
    password: '',      
    database: 'sukanplay_db',
    waitForConnections: true,
    connectionLimit: 10,      
    queueLimit: 0             
});

db.getConnection((err, connection) => {
    if (err) return console.error('Database gagal terkoneksi: ' + err.code);
    if (connection) {
        console.log('Terkoneksi ke database MySQL menggunakan Connection Pool 🚀');
        connection.release();
    }
});

// ==========================================
// API MASTER DATA (GET - Public)
// ==========================================
app.get('/api/competitions', (req, res) => {
    db.query("SELECT * FROM competitions ORDER BY id DESC", (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

app.get('/api/patches', (req, res) => {
    db.query("SELECT * FROM game_patches ORDER BY release_date DESC", (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

app.get('/api/teams', (req, res) => {
    db.query("SELECT * FROM teams ORDER BY name ASC", (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

app.get('/api/players/:teamId', (req, res) => {
    const teamId = req.params.teamId;
    db.query("SELECT * FROM players WHERE team_id = ?", [teamId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

// ==========================================
// API JADWAL TURNAMEN (SCHEDULES)
// ==========================================
app.get('/api/schedules/:comp_id', (req, res) => {
    const compId = req.params.comp_id;
    const sql = `
        SELECT 
            s.id, s.week_number, DATE_FORMAT(s.match_date, '%Y-%m-%d') AS match_date, s.status, s.match_log_id,
            tHome.name AS team_home, tHome.id AS team_home_id,
            tAway.name AS team_away, tAway.id AS team_away_id
        FROM match_schedules s
        JOIN teams tHome ON s.team_home_id = tHome.id
        JOIN teams tAway ON s.team_away_id = tAway.id
        WHERE s.competition_id = ?
        ORDER BY s.week_number ASC, s.match_date ASC
    `;
    db.query(sql, [compId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

// POST Dilindungi API Key
app.post('/api/schedules', (req, res) => {
    const errorMsg = validateInput(['competition_id', 'week_number', 'match_date', 'team_home_id', 'team_away_id'], req.body);
    if (errorMsg) return res.status(400).json({ error: errorMsg });

    const { competition_id, week_number, match_date, team_home_id, team_away_id } = req.body;
    const sql = `INSERT INTO match_schedules (competition_id, week_number, match_date, team_home_id, team_away_id) VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [competition_id, week_number, match_date, team_home_id, team_away_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Jadwal berhasil ditambahkan!" });
    });
});

// ==========================================
// API SIMPAN MATCH LOG (DENGAN VALIDASI KETAT)
// ==========================================
app.post('/api/simpan-log', (req, res) => {
    const data = req.body;

    // Validasi Cek Kosong
    const errorMsg = validateInput(['competitionId', 'patchId', 'matchDate', 'teamAId', 'teamBId', 'winnerId'], data);
    if (errorMsg) return res.status(400).json({ error: errorMsg });

    // Validasi Tipe Data (Cegah masuk akal)
    if (isNaN(data.scoreA) || isNaN(data.scoreB)) {
        return res.status(400).json({ error: "Skor A dan Skor B harus berupa angka!" });
    }

    const sql = `INSERT INTO match_logs 
                 (competition_id, patch_id, match_date, match_time, team_a_id, team_b_id, team_a_heroes, team_b_heroes, team_a_bans, team_b_bans, score_a, score_b, winner_id, notes, timeline_events, player_stats, team_kills, team_deaths, team_assists) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const timelineString = JSON.stringify(data.timelineEvents || []);
    const playerStatsString = JSON.stringify(data.playerStats || []);

    const values = [
        data.competitionId, data.patchId, data.matchDate, data.matchTime || "00:00", 
        data.teamAId, data.teamBId,       
        data.teamAHeroes || "", data.teamBHeroes || "", 
        data.teamABans || "", data.teamBBans || "", 
        data.scoreA, data.scoreB, data.winnerId,      
        data.notes || "", timelineString, playerStatsString, 
        data.teamKills || 0, data.teamDeaths || 0, data.teamAssists || 0 
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Error Simpan:", err);
            return res.status(500).json({ error: 'Gagal menyimpan data log', details: err.message });
        }
        res.status(200).json({ message: 'Log berhasil disimpan!', insertId: result.insertId });
    });
});

// ==========================================
// API RIWAYAT, EDIT, DELETE & ANALYTICS
// ==========================================
app.get('/api/history', (req, res) => {
    const sql = `
        SELECT 
            m.id, m.notes, DATE_FORMAT(m.match_date, '%d %b %Y') as formatted_date, m.match_time, 
            m.score_a, m.score_b, m.team_a_heroes, m.team_b_heroes,
            c.name AS competition_name, p.version AS patch_version,
            tA.name AS team_a_name, tB.name AS team_b_name, tW.name AS winner_name
        FROM match_logs m
        LEFT JOIN competitions c ON m.competition_id = c.id
        LEFT JOIN game_patches p ON m.patch_id = p.id
        LEFT JOIN teams tA ON m.team_a_id = tA.id
        LEFT JOIN teams tB ON m.team_b_id = tB.id
        LEFT JOIN teams tW ON m.winner_id = tW.id
        ORDER BY m.match_date DESC, m.match_time DESC
    `;
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: 'Gagal mengambil riwayat' });
        res.json(result);
    });
});

app.delete('/api/match/:id', (req, res) => {
    db.query("DELETE FROM match_logs WHERE id = ?", [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Gagal menghapus data' });
        res.json({ message: 'Pertandingan berhasil dihapus!' });
    });
});

app.get('/api/analytics', (req, res) => {
    const sql = `
        SELECT 
            m.score_a, m.score_b, m.team_a_heroes, m.team_b_heroes, m.team_a_bans, m.team_b_bans, m.player_stats,
            tA.name AS team_home, tB.name AS team_away, tW.name AS winner_name
        FROM match_logs m
        LEFT JOIN teams tA ON m.team_a_id = tA.id
        LEFT JOIN teams tB ON m.team_b_id = tB.id
        LEFT JOIN teams tW ON m.winner_id = tW.id
    `;
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: 'Gagal mengambil data analytics' });
        res.json(result);
    });
});

app.listen(3000, () => {
    console.log('Server API Berjalan di http://localhost:3000 🔒 (Secured)');
});
