const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/esp32');

ws.on('open', () => {
    console.log('✓ Connexion WebSocket OK — le serveur accepte /esp32');
    let i = 0;
    const interval = setInterval(() => {
        ws.send('120.5,115.3');
        console.log(`  Envoi #${++i} : 120.5,115.3`);
        if (i >= 3) { clearInterval(interval); ws.close(); }
    }, 500);
});

ws.on('close', () => console.log('  Connexion fermée.'));
ws.on('error', err => console.error('✗ Erreur :', err.message));
