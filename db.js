const { Pool } = require('pg');

const pool = new Pool({
    host:                 process.env.PG_HOST     || 'localhost',
    port:                 parseInt(process.env.PG_PORT || '5432'),
    database:             process.env.PG_DATABASE || 'flexitrack',
    user:                 process.env.PG_USER     || 'postgres',
    password:             process.env.PG_PASSWORD || '',
    keepAlive:            true,
    idleTimeoutMillis:    600000,
    connectionTimeoutMillis: 5000,
    max:                  10,
});

pool.on('error', err => console.error('[PostgreSQL] Erreur inattendue :', err.message));
pool.on('connect', () => console.log('[DB] Nouvelle connexion établie.'));

async function initTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin (
            id            SERIAL PRIMARY KEY,
            username      VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at    TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS patients (
            id              SERIAL PRIMARY KEY,
            nom             VARCHAR(100) NOT NULL,
            prenom          VARCHAR(100) NOT NULL,
            date_naissance  DATE        NOT NULL,
            telephone       VARCHAR(30) NOT NULL,
            genre           VARCHAR(10) NOT NULL,
            notes           TEXT        DEFAULT '',
            seuil_alerte    INTEGER     DEFAULT 75,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS seances (
            id          SERIAL PRIMARY KEY,
            patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            date        DATE    NOT NULL,
            rms_left    FLOAT   NOT NULL,
            rms_right   FLOAT   NOT NULL,
            balance     FLOAT   NOT NULL,
            duration    INTEGER NOT NULL,
            notes       TEXT    DEFAULT '',
            signal_data JSONB   DEFAULT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS rendez_vous (
            id         SERIAL PRIMARY KEY,
            patient_id INTEGER      NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            date       DATE         NOT NULL,
            heure      TIME         NOT NULL,
            type       VARCHAR(100) NOT NULL,
            statut     VARCHAR(20)  DEFAULT 'confirmed',
            created_at TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS historique (
            id          SERIAL PRIMARY KEY,
            table_name  VARCHAR(50) NOT NULL,
            record_id   INTEGER,
            action      VARCHAR(10) NOT NULL,
            old_data    JSONB,
            new_data    JSONB,
            effectue_le TIMESTAMPTZ DEFAULT NOW()
        );

        ALTER TABLE patients ADD COLUMN IF NOT EXISTS seuil_alerte INTEGER DEFAULT 75;

        CREATE INDEX IF NOT EXISTS idx_seances_patient    ON seances(patient_id);
        CREATE INDEX IF NOT EXISTS idx_rdv_patient        ON rendez_vous(patient_id);
        CREATE INDEX IF NOT EXISTS idx_historique_table   ON historique(table_name, record_id);
        CREATE INDEX IF NOT EXISTS idx_historique_date    ON historique(effectue_le DESC);
    `);
    console.log('[DB] Tables prêtes.');
}

module.exports = { pool, initTables };
