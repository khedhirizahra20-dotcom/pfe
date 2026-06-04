-- ============================================================
--  FlexiTrack — Schéma PostgreSQL
--  Généré automatiquement par db.js au démarrage
-- ============================================================

-- Administrateur
CREATE TABLE IF NOT EXISTS admin (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Patients
CREATE TABLE IF NOT EXISTS patients (
    id             SERIAL PRIMARY KEY,
    nom            VARCHAR(100) NOT NULL,
    prenom         VARCHAR(100) NOT NULL,
    date_naissance DATE        NOT NULL,
    telephone      VARCHAR(30) NOT NULL,
    genre          VARCHAR(10) NOT NULL,
    notes          TEXT        DEFAULT '',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Séances EMG
--   signal_data : tableau JSON des échantillons bruts reçus de l'Arduino
--                 format : { "left": [v1,v2,...], "right": [v1,v2,...] }
CREATE TABLE IF NOT EXISTS seances (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date        DATE    NOT NULL,
    rms_left    FLOAT   NOT NULL,   -- RMS moyen côté gauche (mV)
    rms_right   FLOAT   NOT NULL,   -- RMS moyen côté droit  (mV)
    balance     FLOAT   NOT NULL,   -- Balance musculaire (%)
    duration    INTEGER NOT NULL,   -- Durée de la séance (secondes)
    notes       TEXT    DEFAULT '',
    signal_data JSONB   DEFAULT NULL,  -- Signal brut Arduino
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Rendez-vous
CREATE TABLE IF NOT EXISTS rendez_vous (
    id         SERIAL PRIMARY KEY,
    patient_id INTEGER      NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date       DATE         NOT NULL,
    heure      TIME         NOT NULL,
    type       VARCHAR(100) NOT NULL,
    statut     VARCHAR(20)  DEFAULT 'confirmed',
    created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Historique des modifications (journal de bord)
--   Enregistre chaque INSERT / UPDATE / DELETE sur patients, seances, rendez_vous
CREATE TABLE IF NOT EXISTS historique (
    id          SERIAL PRIMARY KEY,
    table_name  VARCHAR(50) NOT NULL,   -- 'patients' | 'seances' | 'rendez_vous'
    record_id   INTEGER,                -- ID de l'enregistrement concerné
    action      VARCHAR(10) NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
    old_data    JSONB,                  -- État avant (NULL pour INSERT)
    new_data    JSONB,                  -- État après  (NULL pour DELETE)
    effectue_le TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_seances_patient  ON seances(patient_id);
CREATE INDEX IF NOT EXISTS idx_rdv_patient       ON rendez_vous(patient_id);
CREATE INDEX IF NOT EXISTS idx_historique_table  ON historique(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_historique_date   ON historique(effectue_le DESC);
