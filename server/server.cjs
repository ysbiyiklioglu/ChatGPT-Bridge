const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const MAIN_SERVER_PORT = 3000;
const MCP_PORT = parseInt(process.env.MCP_PORT || '3001', 10);
const isMcpMode = process.env.MCP_MODE === '1' || !process.env.WS_PORT;
const PORT = isMcpMode ? MCP_PORT : MAIN_SERVER_PORT;
let connectedExtension = null;
const pendingRequests = new Map();
let httpReady = false;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendToExtension(msg, timeout = 600000) {
  return new Promise((resolve, reject) => {
    if (!connectedExtension || connectedExtension.readyState !== WebSocket.OPEN) {
      console.error(`[sendToExtension] No extension connected (ext=${!!connectedExtension}, state=${connectedExtension?.readyState})`);
      return reject(new Error('Extension bagli degil. Chrome\'da chatgpt.com acip extension\'i baglayin.'));
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    console.error(`[sendToExtension] Sending msg.type=${msg.type} id=${id} timeout=${timeout} pendingBefore=${pendingRequests.size}`);
    const timer = setTimeout(() => {
      console.error(`[sendToExtension] TIMEOUT for id=${id} after ${timeout}ms, pendingNow=${pendingRequests.size}`);
      pendingRequests.delete(id);
      reject(new Error('Timeout: ' + timeout + 'ms'));
    }, timeout);
    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timer); console.error(`[sendToExtension] RESOLVED id=${id} responseLen=${(v||'').length}`); resolve(v); },
      reject: (e) => { clearTimeout(timer); console.error(`[sendToExtension] REJECTED id=${id} err=${e.message}`); reject(e); }
    });
    connectedExtension.send(JSON.stringify({ ...msg, requestId: id }));
  });
}

// Mevcut sunucuya HTTP isteği gönder (eğer zaten çalışıyorsa)
async function sendToExistingServer(msg, timeout = 600000, path = '/send') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(msg);
    const req = http.request({
      hostname: '127.0.0.1',
      port: MAIN_SERVER_PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: timeout + 5000
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.status === 'ok') {
            resolve(parsed.response);
          } else {
            reject(new Error(parsed.error || 'Hata'));
          }
        } catch (e) {
          reject(new Error('Gecersiz yanit'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(data);
    req.end();
  });
}

async function pingExistingServer(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: MAIN_SERVER_PORT,
      path: '/ping',
      method: 'POST',
      timeout
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Gecersiz yanit'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

function downloadFile(url, savePath) {
  return new Promise((resolve, reject) => {
    const https = url.startsWith('https') ? require('https') : require('http');
    const fs = require('fs');
    const path = require('path');

    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(savePath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(savePath);
        return downloadFile(response.headers.location, savePath).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(savePath); });
    }).on('error', (err) => {
      fs.unlink(savePath, () => {});
      reject(err);
    });
  });
}

// HTTP + WebSocket sunucusu (opsiyonel)
try {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/status' && req.method === 'GET') {
      sendJson(res, 200, {
        extensionConnected: connectedExtension !== null && connectedExtension.readyState === WebSocket.OPEN,
        pendingRequests: pendingRequests.size
      });
      return;
    }

    if (req.url === '/send' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        if (!body.message) {
          sendJson(res, 400, { status: 'error', error: 'message field is required' });
          return;
        }
        const timeout = body.timeout || 600000;
        console.error(`[HTTP /send] Got message (${body.message.length} chars), timeout=${timeout}, ext=${!!connectedExtension}, wsState=${connectedExtension?.readyState}`);
        const response = await sendToExtension(
          { type: 'SEND_MESSAGE', text: body.message, timeout },
          timeout + 5000
        );
        console.error(`[HTTP /send] Response received (${(response||'').length} chars)`);
        sendJson(res, 200, { status: 'ok', response });
      } catch (e) {
        console.error(`[HTTP /send] Error:`, e.message);
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/ping' && req.method === 'POST') {
      try {
        const result = await sendToExtension({ type: 'PING' }, 15000);
        const parsed = JSON.parse(result);
        sendJson(res, 200, { tabFound: parsed.tabFound, contentScriptAlive: parsed.alive });
      } catch (e) {
        sendJson(res, 500, { tabFound: false, contentScriptAlive: false, error: e.message });
      }
      return;
    }

    if (req.url === '/newchat' && req.method === 'POST') {
      try {
        await sendToExtension({ type: 'NEW_CHAT' }, 10000);
        sendJson(res, 200, { status: 'ok' });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/history' && req.method === 'POST') {
      try {
        const r = await sendToExtension({ type: 'GET_HISTORY' }, 10000);
        sendJson(res, 200, { status: 'ok', response: r });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/debug' && req.method === 'POST') {
      try {
        const r = await sendToExtension({ type: 'DEBUG' }, 10000);
        sendJson(res, 200, { status: 'ok', response: r });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/upload' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        if (!body.fileData) {
          sendJson(res, 400, { status: 'error', error: 'fileData required' });
          return;
        }
        const r = await sendToExtension({
          type: 'UPLOAD_FILE',
          fileData: body.fileData,
          mimeType: body.mimeType,
          fileName: body.fileName,
          text: body.text || ''
        }, 30000);
        sendJson(res, 200, { status: 'ok', response: r });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/images' && req.method === 'POST') {
      try {
        const r = await sendToExtension({ type: 'GET_LAST_IMAGES' }, 10000);
        sendJson(res, 200, { status: 'ok', response: r });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    if (req.url === '/download' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        if (!body.url) {
          sendJson(res, 400, { status: 'error', error: 'url required' });
          return;
        }
        const savePath = body.savePath || ('downloads/' + (body.fileName || Date.now() + '.png'));
        const r = await sendToExtension({ type: 'DOWNLOAD_IMAGE', url: body.url, savePath }, 30000);
        if (r) {
          const parsed = typeof r === 'string' ? JSON.parse(r) : r;
          if (parsed.data) {
            const fs = require('fs');
            const path = require('path');
            const dir = path.dirname(savePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const buffer = Buffer.from(parsed.data, 'base64');
            fs.writeFileSync(savePath, buffer);
            sendJson(res, 200, { status: 'ok', response: JSON.stringify({ savedPath: savePath, size: buffer.length }) });
          } else {
            sendJson(res, 200, { status: 'ok', response: parsed });
          }
        } else {
          sendJson(res, 200, { status: 'ok' });
        }
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  const wss = new WebSocketServer({ server });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[MCP] WebSocket port ${PORT} zaten kullaniliyor`);
    }
  });

  wss.on('connection', (ws) => {
    console.error('[WS] Chrome extension baglandi');
    connectedExtension = ws;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'KEEPALIVE') return;

      console.error(`[WS recv] type=${msg.type} requestId=${msg.requestId} pendingCount=${pendingRequests.size}`);

      if (msg.type === 'CHATGPT_RESULT' && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          console.error(`[WS] CHATGPT_RESULT matched requestId=${msg.requestId} responseLen=${(msg.response||'').length}`);
          pending.resolve(msg.response || '');
          pendingRequests.delete(msg.requestId);
        } else {
          console.error(`[WS] CHATGPT_RESULT no pending for requestId=${msg.requestId}`);
        }
      }

      if (msg.type === 'CHATGPT_RESULT_ERROR' && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          console.error(`[WS] CHATGPT_RESULT_ERROR requestId=${msg.requestId} err=${msg.error}`);
          pending.reject(new Error(msg.error || 'Hata'));
          pendingRequests.delete(msg.requestId);
        } else {
          console.error(`[WS] CHATGPT_RESULT_ERROR no pending for requestId=${msg.requestId}`);
        }
      }

      if (msg.type === 'PONG' && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          pending.resolve(JSON.stringify({ tabFound: msg.tabFound, alive: msg.contentScriptAlive }));
          pendingRequests.delete(msg.requestId);
        }
      }
    });

    ws.on('close', () => {
      console.error('[WS] Chrome extension kesildi');
      connectedExtension = null;
      pendingRequests.forEach(p => p.reject(new Error('Baglanti kesildi')));
      pendingRequests.clear();
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[MCP] Port ${PORT} zaten kullaniliyor, HTTP sunucusu atlandi`);
    } else {
      console.error(`[MCP] Sunucu hatasi:`, err);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.error(`[MCP] HTTP+WS baslatildi (port ${PORT})`);
  });
} catch (e) {
  console.error(`[MCP] HTTP sunucusu baslatilamadi:`, e.message);
}

// MCP stdin okuma (JSON-RPC)
process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      await handleMcpRequest(request);
    } catch (e) {
      console.error('[MCP] Parse error:', e.message);
    }
  }
});

async function handleMcpRequest(request) {
  const { id, method, params } = request;

  if (method === 'initialize') {
    sendJsonRpc(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'chatgpt-bridge', version: '1.0.0' }
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    sendJsonRpc(id, {
      tools: [
        {
          name: 'chatgpt_send',
          description: 'ChatGPT web arayuzune mesaj gonderir ve yaniTI bekler',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Gonderilecek mesaj' },
              context: { type: 'string', description: 'Sayfa baglami (opsiyonel)' },
              timeout: { type: 'number', description: 'Bekleme suresi (ms)', default: 600000 }
            },
            required: ['message']
          }
        },
        {
          name: 'chatgpt_quick',
          description: 'Hizli aksiyon: ozetle, cevir, acikla, kod incele',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['summarize', 'translate', 'explain', 'review', 'rewrite'] },
              text: { type: 'string', description: 'Islenecek metin' },
              language: { type: 'string', description: 'Hedef dil', default: 'Turkce' }
            },
            required: ['action', 'text']
          }
        },
        {
          name: 'chatgpt_status',
          description: 'Extension ve ChatGPT durumunu kontrol eder',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chatgpt_new_chat',
          description: 'Yeni sohbet baslatir',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chatgpt_history',
          description: 'Sohbet gecmisini getirir',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chatgpt_debug',
          description: 'Sayfa DOM yapisini debug eder',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chatgpt_upload',
          description: 'Bilgisayardan dosya secip ChatGPT\'ye yukler',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Yuklenecek dosyanin tam yolu' },
              text: { type: 'string', description: 'Dosya ile birlikte gonderilecek mesaj (opsiyonel)' }
            },
            required: ['filePath']
          }
        },
        {
          name: 'chatgpt_images',
          description: 'ChatGPT\'nin son cevabindaki resimleri listeler',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'chatgpt_download',
          description: 'ChatGPT\'nin gonderdigi resim/dosyayi bilgisayara indirir',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Indirilecek dosyanin URL\'i' },
              savePath: { type: 'string', description: 'Kaydedilecek dosya yolu (opsiyonel, varsayilan: downloads/dosyaadi)' },
              fileName: { type: 'string', description: 'Dosya adi (opsiyonel)' }
            },
            required: ['url']
          }
        }
      ]
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      let result;
      let useHttp = !connectedExtension || connectedExtension.readyState !== WebSocket.OPEN;
      console.error(`[MCP] tools/call name=${name} useHttp=${useHttp} ext=${!!connectedExtension} state=${connectedExtension?.readyState}`);

      if (useHttp) {
        try {
          await pingExistingServer(3000);
          console.error(`[MCP] Main server reachable on port ${MAIN_SERVER_PORT}`);
        } catch {
          console.error(`[MCP] Main server NOT reachable, using direct WS`);
          useHttp = false;
        }
      }
      
      switch (name) {
        case 'chatgpt_send': {
          let fullMessage = args.message;
          if (args.context) {
            fullMessage = `[Sayfa Baglami: ${args.context}]\n\n${args.message}`;
          }
          if (useHttp) {
            result = await sendToExistingServer({ message: fullMessage, timeout: args.timeout || 600000 }, (args.timeout || 600000) + 5000);
          } else {
            result = await sendToExtension({ type: 'SEND_MESSAGE', text: fullMessage, timeout: args.timeout || 600000 }, (args.timeout || 600000) + 5000);
          }
          break;
        }
        case 'chatgpt_quick': {
          const prompts = {
            summarize: `Asagidaki metni 3-4 cumle ile ozetle:\n\n${args.text}`,
            translate: `Asagidaki metni ${args.language || 'Turkce'}'ye cevir:\n\n${args.text}`,
            explain: `Asagidaki metni basit bir dille acikla:\n\n${args.text}`,
            review: `Asagidaki kodu incele ve iyilestirme onerileri ver:\n\n${args.text}`,
            rewrite: `Asagidaki metni daha akici ve profesyonel bir sekilde yeniden yaz:\n\n${args.text}`
          };
          if (useHttp) {
            result = await sendToExistingServer({ message: prompts[args.action], timeout: 600000 }, 605000);
          } else {
            result = await sendToExtension({ type: 'SEND_MESSAGE', text: prompts[args.action], timeout: 600000 }, 605000);
          }
          break;
        }
        case 'chatgpt_status': {
          try {
            const s = await pingExistingServer(5000);
            result = JSON.stringify({ wsConnected: true, chatgptTabFound: s.tabFound, contentScriptAlive: s.contentScriptAlive });
          } catch {
            result = JSON.stringify({ wsConnected: false, chatgptTabFound: false, contentScriptAlive: false });
          }
          break;
        }
        case 'chatgpt_new_chat':
          if (useHttp) {
            await sendToExistingServer({}, 10000, '/newchat');
          } else {
            await sendToExtension({ type: 'NEW_CHAT' }, 10000);
          }
          result = 'Yeni sohbet baslatildi';
          break;
        case 'chatgpt_history': {
          if (useHttp) {
            const r = await sendToExistingServer({}, 10000, '/history');
            result = r;
          } else {
            const r = await sendToExtension({ type: 'GET_HISTORY' }, 10000);
            result = r;
          }
          break;
        }
        case 'chatgpt_debug': {
          if (useHttp) {
            const r = await sendToExistingServer({}, 10000, '/debug');
            result = r;
          } else {
            const r = await sendToExtension({ type: 'DEBUG' }, 10000);
            result = r;
          }
          break;
        }
        case 'chatgpt_upload': {
          const fs = require('fs');
          const filePath = args.filePath;
          if (!fs.existsSync(filePath)) {
            throw new Error('Dosya bulunamadi: ' + filePath);
          }
          const fileBuffer = fs.readFileSync(filePath);
          const fileBase64 = fileBuffer.toString('base64');
          const ext = require('path').extname(filePath).toLowerCase();
          const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript', '.html': 'text/html', '.css': 'text/css' };
          const mimeType = mimeMap[ext] || 'application/octet-stream';
          const fileName = require('path').basename(filePath);
          if (useHttp) {
            result = await sendToExistingServer({ fileData: fileBase64, mimeType, fileName, text: args.text || '' }, 30000, '/upload');
          } else {
            result = await sendToExtension({ type: 'UPLOAD_FILE', fileData: fileBase64, mimeType, fileName, text: args.text || '' }, 30000);
          }
          break;
        }
        case 'chatgpt_images': {
          if (useHttp) {
            result = await sendToExistingServer({}, 10000, '/images');
          } else {
            const r = await sendToExtension({ type: 'GET_LAST_IMAGES' }, 10000);
            result = r;
          }
          break;
        }
        case 'chatgpt_download': {
          if (!args.url) throw new Error('url required');
          const savePath = args.savePath || ('downloads/' + (args.fileName || Date.now() + '.png'));
          if (useHttp) {
            result = await sendToExistingServer({ url: args.url, savePath, fileName: args.fileName }, 30000, '/download');
          } else {
            const r = await sendToExtension({ type: 'DOWNLOAD_IMAGE', url: args.url, savePath }, 30000);
            if (r) {
              const parsed = typeof r === 'string' ? JSON.parse(r) : r;
              if (parsed.data) {
                const fs = require('fs');
                const path = require('path');
                const dir = path.dirname(savePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const buffer = Buffer.from(parsed.data, 'base64');
                fs.writeFileSync(savePath, buffer);
                result = { savedPath: savePath, size: buffer.length };
              } else {
                result = parsed;
              }
            }
          }
          break;
        }
        default:
          throw new Error('Bilinmeyen tool: ' + name);
      }
      const textResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      sendJsonRpc(id, { content: [{ type: 'text', text: textResult }] });
    } catch (error) {
      sendJsonRpc(id, { content: [{ type: 'text', text: 'Hata: ' + error.message }], isError: true });
    }
    return;
  }

  if (method === 'ping') {
    sendJsonRpc(id, {});
    return;
  }
}

function sendJsonRpc(id, result) {
  const response = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(response) + '\n');
}

console.error('[MCP] ChatGPT Bridge MCP baslatildi (stdio aktif)');
