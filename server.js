const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// 1. KONFIGURASI DATABASE
// ==========================================
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: '',      
    database: 'sukanplay_db'
});

db.connect(err => {
    if (err) {
        console.error('Database gagal terkoneksi: ' + err.stack);
        return;
    }
    console.log('Terkoneksi ke database MySQL');
});

// ==========================================
// 2. MIDDLEWARE KEAMANAN (AUTENTIKASI)
// ==========================================
// Kunci rahasia ini sebaiknya nanti disimpan di file .env
const SECRET_API_KEY = "esports-admin-123"; 

// Fungsi untuk mengecek izin akses
function cekOtorisasi(req, res, next) {
    // Mengecek header 'x-api-key' yang dikirim dari frontend
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || apiKey !== SECRET_API_KEY) {
        return res.status(403).json({ 
            success: false, 
            message: "Akses Ditolak! Anda tidak memiliki izin untuk mengubah data." 
        });
    }
    next(); // Jika key benar, lanjut ke proses berikutnya
}


// ==========================================
// 3. API BACA DATA (GET) -> TERBUKA UNTUK PUBLIK
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

// History, Analytics, & Schedules (Aman dibuka untuk publik/viewer)
app.get('/api/history', (req, res) => {
    const sql = `
        SELECT 
            m.id, m.notes, DATE_FORMAT(m.match_date, '%d %b %Y') as formatted_date, 
            m.match_time, m.score_a, m.score_b, m.team_a_heroes, m.team_b_heroes, 
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

app.get('/api/analytics', (req, res) => {
    const sql = `
        SELECT 
            m.score_a, m.score_b, m.team_a_heroes, m.team_b_heroes, 
            m.team_a_bans, m.team_b_bans, m.player_stats,
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


// ==========================================
// 4. API UBAH DATA (POST/PUT/DELETE) -> DILINDUNGI `cekOtorisasi`
// ==========================================

// Tambah Data Master
app.post('/api/competitions', cekOtorisasi, (req, res) => {
    const { name, region, tier } = req.body;
    db.query("INSERT INTO competitions (name, region, tier) VALUES (?, ?, ?)", [name, region, tier], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Kompetisi berhasil ditambahkan!" });
    });
});

app.post('/api/patches', cekOtorisasi, (req, res) => {
    const { version, description } = req.body;
    db.query("INSERT INTO game_patches (version, description) VALUES (?, ?)", [version, description], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Patch berhasil ditambahkan!" });
    });
});

app.post('/api/teams', cekOtorisasi, (req, res) => {
    const { name, acronym } = req.body;
    db.query("INSERT INTO teams (name, acronym) VALUES (?, ?)", [name, acronym], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Tim berhasil ditambahkan!" });
    });
});

app.post('/api/players', cekOtorisasi, (req, res) => {
    const { team_id, ign, full_name, main_role } = req.body;
    db.query("INSERT INTO players (team_id, ign, full_name, main_role) VALUES (?, ?, ?, ?)", 
    [team_id, ign, full_name, main_role], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Pemain berhasil ditambahkan!" });
    });
});

// Simpan Log Match
app.post('/api/simpan-log', cekOtorisasi, (req, res) => {
    const data = req.body;
    const sql = `INSERT INTO match_logs 
                 (competition_id, patch_id, match_date, match_time, team_a_id, team_b_id, team_a_heroes, team_b_heroes, team_a_bans, team_b_bans, score_a, score_b, winner_id, notes, timeline_events, player_stats, team_kills, team_deaths, team_assists) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const timelineString = JSON.stringify(data.timelineEvents || []);
    const playerStatsString = JSON.stringify(data.playerStats || []);

    const values = [
        data.competitionId, data.patchId, data.matchDate, data.matchTime, 
        data.teamAId, data.teamBId, data.teamAHeroes, data.teamBHeroes, 
        data.teamABans || "", data.teamBBans || "", data.scoreA, data.scoreB, 
        data.winnerId, data.notes, timelineString, playerStatsString, 
        data.teamKills || 0, data.teamDeaths || 0, data.teamAssists || 0 
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Error Simpan:", err);
            res.status(500).json({ message: 'Gagal menyimpan data log', error: err.message });
        } else {
            res.status(200).json({ message: 'Log berhasil disimpan!' });
        }
    });
});

// Edit & Hapus Match
app.delete('/api/match/:id', cekOtorisasi, (req, res) => {
    const matchId = req.params.id;
    db.query("DELETE FROM match_logs WHERE id = ?", [matchId], (err, result) => {
        if (err) return res.status(500).json({ error: 'Gagal menghapus data' });
        res.json({ message: 'Pertandingan berhasil dihapus!' });
    });
});

app.put('/api/match/:id', cekOtorisasi, (req, res) => {
    const matchId = req.params.id;
    const { score_a, score_b, notes } = req.body;
    
    const sql = "UPDATE match_logs SET score_a = ?, score_b = ?, notes = ? WHERE id = ?";
    db.query(sql, [score_a, score_b, notes, matchId], (err, result) => {
        if (err) return res.status(500).json({ error: 'Gagal mengupdate data' });
        res.json({ message: 'Data pertandingan berhasil diubah!' });
    });
});

// Kelola Schedule
app.post('/api/schedules', cekOtorisasi, (req, res) => {
    const { competition_id, week_number, match_date, team_home_id, team_away_id } = req.body;
    const sql = `INSERT INTO match_schedules (competition_id, week_number, match_date, team_home_id, team_away_id) 
                 VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [competition_id, week_number, match_date, team_home_id, team_away_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Jadwal berhasil ditambahkan!" });
    });
});

app.put('/api/schedules/:id/complete', cekOtorisasi, (req, res) => {
    const scheduleId = req.params.id;
    const { match_log_id } = req.body; 
    const sql = "UPDATE match_schedules SET status = 'Completed', match_log_id = ? WHERE id = ?";
    db.query(sql, [match_log_id, scheduleId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Status jadwal berhasil diubah menjadi Completed!" });
    });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(3000, () => {
    console.log('Server berjalan di http://localhost:3000');
});
