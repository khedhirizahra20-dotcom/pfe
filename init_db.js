/**
 * Script à exécuter UNE SEULE FOIS pour créer la base de données PostgreSQL.
 * Usage : node init_db.js
 * Variables d'environnement optionnelles : PG_HOST, PG_PORT, PG_USER, PG_PASSWORD
 */
const { Client } = require('pg');

async function main() {
    const cfg = {
        host:     process.env.PG_HOST     || 'localhost',
        port:     parseInt(process.env.PG_PORT     || '5432'),
        user:     process.env.PG_USER     || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: 'postgres',
    };

    console.log(`Connexion à PostgreSQL (${cfg.host}:${cfg.port}) en tant que "${cfg.user}"...`);
    const client = new Client(cfg);

    try {
        await client.connect();

        const { rows } = await client.query(
            `SELECT 1 FROM pg_database WHERE datname = 'flexitrack'`
        );

        if (rows.length) {
            console.log('Base de données "flexitrack" existe déjà — aucune action.');
        } else {
            await client.query('CREATE DATABASE flexitrack');
            console.log('Base de données "flexitrack" créée avec succès.');
        }

        console.log('\nInitialisation terminée.');
        console.log('Démarrez le serveur avec : node server.js  (ou start.bat)');
    } catch (err) {
        console.error('\nErreur :', err.message);
        console.error('Vérifiez que PostgreSQL est démarré et que les identifiants sont corrects.');
        console.error('Vous pouvez définir : PG_HOST, PG_PORT, PG_USER, PG_PASSWORD');
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
