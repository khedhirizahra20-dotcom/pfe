const express    = require('express');
const http       = require('http');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const { WebSocketServer, WebSocket: WS } = require('ws');
const { SerialPort }     = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { pool, initTables } = require('./db');

const app        = express();
const server     = http.createServer(app);
const wss        = new WebSocketServer({ server });
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flexitrack-secret-2024';

// ── Arduino (port série côté serveur) ─────────────────────────────────────────
let arduinoPort = null;
let esp32Socket = null;
const wsClients = new Set();

wss.on('connection', (ws, request) => {
    if (request.url === '/esp32') {
        // ── Connexion ESP32 via WiFi ──────────────────────────────────────────
        esp32Socket = ws;
        console.log('[ESP32] Connecté');
        broadcast({ type: 'esp32', connected: true });

        ws.on('message', data => {
            const line = data.toString().trim();
            const parts = line.split(',');
            if (parts.length >= 2) {
                const vL = parseFloat(parts[0]);
                const vR = parseFloat(parts[1]);
                if (!isNaN(vL) && !isNaN(vR)) broadcast({ type: 'emg', vL, vR });
            }
        });

        ws.on('close', () => {
            esp32Socket = null;
            console.log('[ESP32] Déconnecté');
            broadcast({ type: 'esp32', connected: false });
        });

        ws.on('error', () => {
            esp32Socket = null;
            broadcast({ type: 'esp32', connected: false });
        });
    } else {
        // ── Connexion navigateur ──────────────────────────────────────────────
        wsClients.add(ws);
        ws.on('close', () => wsClients.delete(ws));
        ws.on('error', () => wsClients.delete(ws));
        ws.send(JSON.stringify({
            type: 'status',
            connected: arduinoPort !== null && arduinoPort.isOpen,
            port: arduinoPort?.path || null,
            esp32: esp32Socket !== null
        }));
    }
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wsClients) {
        if (client.readyState === WS.OPEN) client.send(msg);
    }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── Wrapper async pour capturer les erreurs ───────────────────────────────────
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── Middleware auth ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    }
}

// ── Journal des modifications ─────────────────────────────────────────────────
async function logChange(tableName, recordId, action, oldData, newData) {
    await pool.query(
        `INSERT INTO historique (table_name, record_id, action, old_data, new_data)
         VALUES ($1, $2, $3, $4, $5)`,
        [tableName, recordId,  action,
         oldData ? JSON.stringify(oldData) : null,
         newData ? JSON.stringify(newData) : null]
    );
}

// ── Helpers de formatage ──────────────────────────────────────────────────────
function fmtDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(val).slice(0, 10);
}

function fmtPatient(row) {
    return {
        id:            String(row.id),
        nom:           row.nom,
        prenom:        row.prenom,
        dateNaissance: fmtDate(row.date_naissance),
        telephone:     row.telephone,
        genre:         row.genre,
        notes:         row.notes || '',
        seuilAlerte:   row.seuil_alerte ?? 75,
        sessions:      []
    };
}

function fmtSession(row) {
    return {
        id:         String(row.id),
        date:       fmtDate(row.date),
        rmsLeft:    parseFloat(row.rms_left),
        rmsRight:   parseFloat(row.rms_right),
        balance:    parseFloat(row.balance),
        duration:   parseInt(row.duration),
        notes:      row.notes || '',
        signalData: row.signal_data || null
    };
}

function fmtAppt(row) {
    const heure = row.heure ? String(row.heure).slice(0, 5) : '';
    return {
        id:        String(row.id),
        patientId: String(row.patient_id),
        date:      fmtDate(row.date),
        time:      heure,
        type:      row.type,
        status:    row.statut || 'confirmed'
    };
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/api/auth/registered', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id FROM admin LIMIT 1');
    res.json({ registered: rows.length > 0 });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
    const { rows: existing } = await pool.query('SELECT id FROM admin LIMIT 1');
    if (existing.length) return res.status(409).json({ error: 'Un administrateur existe déjà' });

    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Données manquantes' });

    const passwordHash = bcrypt.hashSync(password, 10);
    await pool.query(
        'INSERT INTO admin (username, password_hash) VALUES ($1, $2)',
        [username, passwordHash]
    );

    // Données de démonstration au premier lancement
    const today = new Date().toISOString().split('T')[0];

    const { rows: [p1] } = await pool.query(
        `INSERT INTO patients (nom, prenom, date_naissance, telephone, genre)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        ['Benali', 'Karim', '1985-03-15', '0555 12 34 56', 'Homme']
    );
    const { rows: [p2] } = await pool.query(
        `INSERT INTO patients (nom, prenom, date_naissance, telephone, genre)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        ['Meziane', 'Amina', '1992-07-22', '0661 98 76 54', 'Femme']
    );
    const { rows: [p3] } = await pool.query(
        `INSERT INTO patients (nom, prenom, date_naissance, telephone, genre)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        ['Boudiaf', 'Youcef', '1978-11-05', '0770 44 55 66', 'Homme']
    );

    await pool.query(
        `INSERT INTO seances (patient_id, date, rms_left, rms_right, balance, duration)
         VALUES ($1,'2026-04-20',230,210,91.3,180), ($1,'2026-04-27',240,225,93.8,200)`,
        [p1.id]
    );
    await pool.query(
        `INSERT INTO seances (patient_id, date, rms_left, rms_right, balance, duration)
         VALUES ($1,'2026-04-25',180,220,81.8,150)`,
        [p2.id]
    );
    await pool.query(
        `INSERT INTO rendez_vous (patient_id, date, heure, type, statut)
         VALUES ($1,$4,'09:00','Suivi','confirmed'),
                ($2,$4,'10:30','Bilan initial','pending'),
                ($3,$4,'14:00','Rééducation','confirmed')`,
        [p1.id, p2.id, p3.id, today]
    );

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const { rows } = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
    if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash))
        return res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect" });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username });
}));

// ── Patients ──────────────────────────────────────────────────────────────────
app.get('/api/patients', requireAuth, wrap(async (req, res) => {
    const { rows: pts } = await pool.query('SELECT * FROM patients ORDER BY nom');
    const { rows: ses } = await pool.query('SELECT * FROM seances ORDER BY date, id');
    const result = pts.map(p => {
        const obj = fmtPatient(p);
        obj.sessions = ses.filter(s => s.patient_id === p.id).map(fmtSession);
        return obj;
    });
    res.json(result);
}));

app.post('/api/patients', requireAuth, wrap(async (req, res) => {
    const { nom, prenom, dateNaissance, telephone, genre, notes } = req.body;
    const { rows: [row] } = await pool.query(
        `INSERT INTO patients (nom, prenom, date_naissance, telephone, genre, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [nom, prenom, dateNaissance, telephone, genre, notes || '']
    );
    const patient = { ...fmtPatient(row), sessions: [] };
    await logChange('patients', row.id, 'INSERT', null, patient);
    res.status(201).json(patient);
}));

app.put('/api/patients/:id', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const { rows: [old] } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (!old) return res.status(404).json({ error: 'Patient introuvable' });

    const { nom, prenom, dateNaissance, telephone, genre, notes } = req.body;
    const { rows: [row] } = await pool.query(
        `UPDATE patients
         SET nom=$1, prenom=$2, date_naissance=$3, telephone=$4, genre=$5, notes=$6, updated_at=NOW()
         WHERE id=$7 RETURNING *`,
        [nom, prenom, dateNaissance, telephone, genre, notes || '', id]
    );
    const updated = fmtPatient(row);
    await logChange('patients', parseInt(id), 'UPDATE', fmtPatient(old), updated);
    res.json(updated);
}));

app.patch('/api/patients/:id/seuil', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const val = Math.min(95, Math.max(50, parseInt(req.body.seuilAlerte ?? 75)));
    await pool.query('UPDATE patients SET seuil_alerte=$1, updated_at=NOW() WHERE id=$2', [val, id]);
    res.json({ success: true, seuilAlerte: val });
}));

app.delete('/api/patients/:id', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const { rows: [old] } = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (!old) return res.status(404).json({ error: 'Patient introuvable' });
    await pool.query('DELETE FROM patients WHERE id = $1', [id]);
    await logChange('patients', parseInt(id), 'DELETE', fmtPatient(old), null);
    res.json({ success: true });
}));

// ── Séances EMG ───────────────────────────────────────────────────────────────
app.post('/api/patients/:id/sessions', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT id FROM patients WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Patient introuvable' });

    const { rmsLeft, rmsRight, balance, duration, notes, date, signalData } = req.body;
    const { rows: [row] } = await pool.query(
        `INSERT INTO seances (patient_id, date, rms_left, rms_right, balance, duration, notes, signal_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id,
         date || new Date().toISOString().split('T')[0],
         rmsLeft, rmsRight, balance, duration,
         notes || '',
         signalData ? JSON.stringify(signalData) : null]
    );
    const session = fmtSession(row);
    await logChange('seances', row.id, 'INSERT', null, session);
    res.status(201).json(session);
}));

app.delete('/api/patients/:id/sessions/:sid', requireAuth, wrap(async (req, res) => {
    const { sid } = req.params;
    const { rows: [old] } = await pool.query('SELECT * FROM seances WHERE id = $1', [sid]);
    if (!old) return res.status(404).json({ error: 'Séance introuvable' });
    await pool.query('DELETE FROM seances WHERE id = $1', [sid]);
    await logChange('seances', parseInt(sid), 'DELETE', fmtSession(old), null);
    res.json({ success: true });
}));

// ── Rendez-vous ───────────────────────────────────────────────────────────────
app.get('/api/appointments', requireAuth, wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM rendez_vous ORDER BY date, heure');
    res.json(rows.map(fmtAppt));
}));

app.post('/api/appointments', requireAuth, wrap(async (req, res) => {
    const { patientId, date, time, type } = req.body;
    const { rows: [row] } = await pool.query(
        `INSERT INTO rendez_vous (patient_id, date, heure, type, statut)
         VALUES ($1,$2,$3,$4,'confirmed') RETURNING *`,
        [patientId, date, time, type]
    );
    const appt = fmtAppt(row);
    await logChange('rendez_vous', row.id, 'INSERT', null, appt);
    res.status(201).json(appt);
}));

app.put('/api/appointments/:id', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const { rows: [old] } = await pool.query('SELECT * FROM rendez_vous WHERE id = $1', [id]);
    if (!old) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const { patientId, date, time, type, status } = req.body;
    const { rows: [row] } = await pool.query(
        `UPDATE rendez_vous SET patient_id=$1, date=$2, heure=$3, type=$4, statut=$5
         WHERE id=$6 RETURNING *`,
        [patientId, date, time, type, status || 'confirmed', id]
    );
    const updated = fmtAppt(row);
    await logChange('rendez_vous', parseInt(id), 'UPDATE', fmtAppt(old), updated);
    res.json(updated);
}));

app.delete('/api/appointments/:id', requireAuth, wrap(async (req, res) => {
    const { id } = req.params;
    const { rows: [old] } = await pool.query('SELECT * FROM rendez_vous WHERE id = $1', [id]);
    if (!old) return res.status(404).json({ error: 'Rendez-vous introuvable' });
    await pool.query('DELETE FROM rendez_vous WHERE id = $1', [id]);
    await logChange('rendez_vous', parseInt(id), 'DELETE', fmtAppt(old), null);
    res.json({ success: true });
}));

// ── Arduino API ───────────────────────────────────────────────────────────────
app.get('/api/arduino/ports', requireAuth, wrap(async (req, res) => {
    const ports = await SerialPort.list();
    res.json(ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '' })));
}));

app.get('/api/arduino/status', requireAuth, (req, res) => {
    res.json({
        connected: arduinoPort !== null && arduinoPort.isOpen,
        port: arduinoPort?.path || null
    });
});

app.post('/api/arduino/connect', requireAuth, wrap(async (req, res) => {
    const { port, baudRate = 115200 } = req.body || {};
    if (!port) return res.status(400).json({ error: 'Port COM requis' });

    if (arduinoPort && arduinoPort.isOpen) {
        await new Promise(resolve => arduinoPort.close(resolve));
        arduinoPort = null;
    }

    try {
        arduinoPort = new SerialPort({ path: port, baudRate: parseInt(baudRate) });
        const parser = arduinoPort.pipe(new ReadlineParser({ delimiter: '\n' }));

        parser.on('data', line => {
            const parts = line.trim().split(',');
            if (parts.length === 2) {
                const vL = parseFloat(parts[0]), vR = parseFloat(parts[1]);
                if (!isNaN(vL) && !isNaN(vR)) broadcast({ type: 'emg', vL, vR });
            }
        });

        arduinoPort.on('error', err => {
            console.error('[Arduino] Erreur :', err.message);
            broadcast({ type: 'status', connected: false, error: err.message });
            arduinoPort = null;
        });

        arduinoPort.on('close', () => {
            broadcast({ type: 'status', connected: false });
            arduinoPort = null;
        });

        broadcast({ type: 'status', connected: true, port });
        res.json({ success: true, port });
    } catch (err) {
        arduinoPort = null;
        const msg = err.message.toLowerCase().includes('access denied')
            ? `Accès refusé sur ${port} — fermez l'Arduino IDE (Serial Monitor) puis réessayez.`
            : err.message;
        res.status(500).json({ error: msg });
    }
}));

app.post('/api/arduino/disconnect', requireAuth, wrap(async (req, res) => {
    if (arduinoPort && arduinoPort.isOpen) {
        await new Promise(resolve => arduinoPort.close(resolve));
        arduinoPort = null;
    }
    broadcast({ type: 'status', connected: false });
    res.json({ success: true });
}));

// ── Historique ────────────────────────────────────────────────────────────────
app.get('/api/history', requireAuth, wrap(async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || '200'), 1000);
    const offset = parseInt(req.query.offset || '0');
    const table  = req.query.table || null;

    let q = 'SELECT * FROM historique';
    const params = [];
    if (table) { q += ' WHERE table_name = $1'; params.push(table); }
    q += ` ORDER BY effectue_le DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(q, params);
    res.json(rows);
}));

// ── Sauvegarde / Restauration ─────────────────────────────────────────────────
app.get('/api/backup', requireAuth, wrap(async (req, res) => {
    const { rows: pts } = await pool.query('SELECT * FROM patients ORDER BY id');
    const { rows: ses } = await pool.query('SELECT * FROM seances ORDER BY id');
    const { rows: apts } = await pool.query('SELECT * FROM rendez_vous ORDER BY id');

    const patients = pts.map(p => ({
        ...fmtPatient(p),
        sessions: ses.filter(s => s.patient_id === p.id).map(fmtSession)
    }));
    res.json({
        version:    '3.0',
        exportDate: new Date().toISOString(),
        patients,
        appointments: apts.map(fmtAppt)
    });
}));

app.post('/api/restore', requireAuth, wrap(async (req, res) => {
    const { patients = [], appointments = [] } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM rendez_vous');
        await client.query('DELETE FROM seances');
        await client.query('DELETE FROM patients');

        for (const p of patients) {
            const { rows: [row] } = await client.query(
                `INSERT INTO patients (nom, prenom, date_naissance, telephone, genre, notes)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [p.nom, p.prenom, p.dateNaissance, p.telephone, p.genre, p.notes || '']
            );
            for (const s of (p.sessions || [])) {
                await client.query(
                    `INSERT INTO seances (patient_id, date, rms_left, rms_right, balance, duration, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [row.id, s.date, s.rmsLeft, s.rmsRight, s.balance, s.duration, s.notes || '']
                );
            }
        }

        for (const a of appointments) {
            const { rows: pt } = await client.query(
                'SELECT id FROM patients WHERE nom=$1 AND prenom=$2 LIMIT 1',
                [patients.find(p => String(p.id) === String(a.patientId))?.nom || '',
                 patients.find(p => String(p.id) === String(a.patientId))?.prenom || '']
            );
            if (pt.length) {
                await client.query(
                    `INSERT INTO rendez_vous (patient_id, date, heure, type, statut)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [pt[0].id, a.date, a.time, a.type, a.status || 'confirmed']
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erreur restauration :', err.message);
        res.status(500).json({ error: 'Erreur lors de la restauration' });
    } finally {
        client.release();
    }
}));

// ── IP locale du serveur (pour configuration ESP32) ──────────────────────────
app.get('/api/server-ip', requireAuth, (req, res) => {
    const nets = require('os').networkInterfaces();
    let ip = 'localhost';
    for (const iface of Object.values(nets)) {
        const found = iface.find(n => n.family === 'IPv4' && !n.internal);
        if (found) { ip = found.address; break; }
    }
    res.json({ ip, port: PORT });
});

// ── Gestionnaire d'erreurs global ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[Erreur]', err.message);
    res.status(500).json({ error: 'Erreur serveur interne' });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
initTables()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`\n  FlexiTrack (PostgreSQL) démarré → http://localhost:${PORT}\n`);
        });
    })
    .catch(err => {
        console.error('\n[ERREUR] Impossible de créer les tables :', err.message);
        console.error('Vérifiez que PostgreSQL est démarré et que la base "flexitrack" existe.');
        console.error('Exécutez d\'abord : node init_db.js\n');
        process.exit(1);
    });
