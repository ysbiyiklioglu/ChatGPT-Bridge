const { WebSocket } = require('ws');

const PORT = 3000;
const command = process.argv[2] || 'send';
const message = process.argv.slice(3).join(' ') || 'Merhaba! Bu bir test mesajidir. Kisa bir yanit ver.';

const pendingRequests = new Map();
let ws;

function sendToExtension(msg, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Extension bagli degil'));
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error('Timeout: ' + timeout + 'ms')); }, timeout);
    pendingRequests.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ ...msg, requestId: id }));
  });
}

ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

ws.on('open', async () => {
  console.error('[WS] Baglanildi: ws://127.0.0.1:' + PORT);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (msg.type === 'KEEPALIVE') return;

    console.error('[WS] Gelen:', msg.type, JSON.stringify(msg).substring(0, 200));

    if (msg.requestId) {
      const p = pendingRequests.get(msg.requestId);
      if (p) {
        if (msg.type === 'CHATGPT_RESULT') p.resolve(msg.response || '');
        else if (msg.type === 'CHATGPT_RESULT_ERROR') p.reject(new Error(msg.error));
        else if (msg.type === 'PONG') p.resolve(JSON.stringify(msg));
        else if (msg.type === 'NEW_CHAT_RESULT') p.resolve(msg.status || 'ok');
        else if (msg.type === 'HISTORY_RESULT') p.resolve(JSON.stringify(msg.history || []));
        pendingRequests.delete(msg.requestId);
      }
    }
  });

  try {
    console.error('1. PING...');
    const pingResult = await sendToExtension({ type: 'PING' }, 5000);
    const status = JSON.parse(pingResult);
    console.error('   Tab:', status.tabFound, 'ContentScript:', status.alive);

    switch (command) {
      case 'status': {
        console.log(JSON.stringify({ tabFound: status.tabFound, contentScriptAlive: status.alive }, null, 2));
        break;
      }
      case 'newchat': {
        console.error('2. Yeni sohbet baslatiliyor...');
        await sendToExtension({ type: 'NEW_CHAT' }, 15000);
        console.log('Yeni sohbet baslatildi');
        break;
      }
      case 'send': {
        console.error('2. Mesaj gonderiliyor:', message.substring(0, 50) + '...');
        const response = await sendToExtension({ type: 'SEND_MESSAGE', text: message, timeout: 90000 }, 95000);
        console.log('YANIT:\n' + response);
        break;
      }
      case 'history': {
        console.error('2. Gecmis aliniyor...');
        const history = await sendToExtension({ type: 'GET_HISTORY' }, 10000);
        console.log('GECMIS:\n' + history);
        break;
      }
      case 'debug': {
        console.error('2. DOM debug...');
        const debug = await sendToExtension({ type: 'DEBUG' }, 10000);
        console.log('DEBUG:\n' + debug);
        break;
      }
      default: {
        console.error('Bilinmeyen komut:', command);
        console.error('Kullanim: node once.cjs <status|newchat|send|history> [mesaj]');
      }
    }
  } catch (e) {
    console.error('HATA:', e.message);
  }

  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[WS] Baglanti hatasi:', err.message);
  process.exit(1);
});
