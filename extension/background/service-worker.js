let ws = null;
let wsUrl = 'ws://localhost:3000';
let reconnectTimer = null;
let keepAliveTimer = null;
let manualDisconnect = false;
let userExplicitConnect = false;
let initialConnectDone = false;
const NATIVE_HOST = 'com.chatgpt.bridge';

async function sendToNativeHost(message, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native host timeout')), timeout);
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function findChatGPTTab() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com'))) {
        return tab;
      }
    }
    return null;
  } catch (e) {
    console.error('[BG] findChatGPTTab error:', e);
    return null;
  }
}

async function ensureContentScript(tabId) {
  try {
    // Once ping ile kontrol et
    const response = await sendToContentScript(tabId, { type: 'PING' }, 2000);
    if (response?.status === 'alive') {
      console.log('[BG] Content script already loaded');
      return true;
    }
  } catch (e) {
    console.log('[BG] Content script not responding:', e.message);
  }
  
  // Yuklenmemis ise enjecte et
  try {
    console.log('[BG] Injecting content script...');
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    console.log('[BG] Script injected, results:', results);
    
    // Wait for script to initialize and register listener
    await new Promise(r => setTimeout(r, 2000));
    
    // Try PING multiple times with longer timeout
    for (let i = 0; i < 3; i++) {
      try {
        const response = await sendToContentScript(tabId, { type: 'PING' }, 3000);
        if (response?.status === 'alive') {
          console.log('[BG] Content script loaded after injection (attempt', i + 1, ')');
          return true;
        }
      } catch (e) {
        console.log('[BG] PING attempt', i + 1, 'failed:', e.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('[BG] Content script still not responding after injection');
    return false;
  } catch (e) {
    console.error('[BG] Script injection error:', e);
    return false;
  }
}

async function sendToContentScript(tabId, message, timeout = 65000) {
  return new Promise((resolve, reject) => {
    console.log('[BG] sendToContentScript tabId=' + tabId + ' type=' + message.type + ' timeout=' + timeout);
    const timer = setTimeout(() => {
      console.error('[BG] sendToContentScript TIMEOUT after ' + timeout + 'ms for type=' + message.type);
      reject(new Error('Content script timeout'));
    }, timeout);
    try {
      chrome.tabs.sendMessage(tabId, message).then((response) => {
        clearTimeout(timer);
        console.log('[BG] sendToContentScript response:', JSON.stringify(response)?.substring(0, 200));
        resolve(response);
      }).catch((err) => {
        clearTimeout(timer);
        console.error('[BG] sendToContentScript error:', err.message);
        reject(new Error(err.message || String(err)));
      });
    } catch (e) {
      clearTimeout(timer);
      console.error('[BG] sendToContentScript catch:', e.message);
      reject(new Error(e.message || String(e)));
    }
  });
}

function keepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'KEEPALIVE' }));
    }
  }, 25000);
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (initialConnectDone && !userExplicitConnect) {
    return;
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.error('[BG] WebSocket create error:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[BG] WebSocket connected to', wsUrl);
    initialConnectDone = true;
    chrome.storage.local.set({ wsStatus: 'connected' });
    keepAlive();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch { return; }

    if (data.type === 'KEEPALIVE') return;

    try {
    if (data.type === 'SEND_MESSAGE') {
      console.log('[BG] SEND_MESSAGE received, requestId=' + data.requestId + ' text=' + (data.text||'').substring(0, 50));
      const tab = await findChatGPTTab();
      if (!tab) {
        console.error('[BG] No ChatGPT tab found');
        ws.send(JSON.stringify({
          type: 'CHATGPT_RESULT_ERROR',
          requestId: data.requestId,
          error: 'ChatGPT sekmesi bulunamadi. chatgpt.com acik olmali.'
        }));
        return;
      }
      console.log('[BG] ChatGPT tab found: ' + tab.id);

      const csReady = await ensureContentScript(tab.id);
      console.log('[BG] Content script ready: ' + csReady);

      try {
        console.log('[BG] Starting message via content script...');
        const startResult = await sendToContentScript(tab.id, {
          type: 'SEND_MESSAGE',
          text: data.text,
          timeout: data.timeout
        }, 10000);
        console.log('[BG] Content script started:', JSON.stringify(startResult));

        if (startResult?.status !== 'started') {
          throw new Error('Content script baslatilamadi');
        }

        const pollInterval = 3000;
        const maxPolls = Math.ceil((data.timeout || 600000) / pollInterval);
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, pollInterval));
          try {
            const pollResult = await sendToContentScript(tab.id, { type: 'POLL_RESULT' }, 5000);
            console.log('[BG] Poll #' + (i+1) + ':', JSON.stringify(pollResult)?.substring(0, 200));
            if (!pollResult?.pending) {
              if (pollResult?.result) {
                ws.send(JSON.stringify({
                  type: 'CHATGPT_RESULT',
                  requestId: data.requestId,
                  response: pollResult.result
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'CHATGPT_RESULT_ERROR',
                  requestId: data.requestId,
                  error: pollResult?.error || 'Yanit alinamadi'
                }));
              }
              return;
            }
          } catch (e) {
            console.error('[BG] Poll error:', e.message);
          }
        }
        throw new Error('Timeout: yanit alinamadi');
      } catch (error) {
        console.error('[BG] Content script error:', error.message);
        ws.send(JSON.stringify({
          type: 'CHATGPT_RESULT_ERROR',
          requestId: data.requestId,
          error: error.message
        }));
      }
    }

    if (data.type === 'PING') {
      try {
        const tab = await findChatGPTTab();
        let alive = false;
        if (tab) {
          alive = await ensureContentScript(tab.id);
          if (alive) {
            try {
              const r = await sendToContentScript(tab.id, { type: 'PING' }, 3000);
              alive = r?.status === 'alive';
            } catch {}
          }
        }
        ws.send(JSON.stringify({
          type: 'PONG',
          requestId: data.requestId,
          tabFound: !!tab,
          contentScriptAlive: alive
        }));
      } catch (e) {
        console.error('[BG] PING error:', e.message);
        ws.send(JSON.stringify({
          type: 'PONG',
          requestId: data.requestId,
          tabFound: false,
          contentScriptAlive: false
        }));
      }
    }

    if (data.type === 'NEW_CHAT') {
      const tab = await findChatGPTTab();
      if (tab) {
        try {
          await sendToContentScript(tab.id, { type: 'NEW_CHAT' }, 5000);
          ws.send(JSON.stringify({ type: 'CHATGPT_RESULT', requestId: data.requestId, response: 'Yeni sohbet baslatildi' }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: error.message }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: 'ChatGPT sekmesi bulunamadi' }));
      }
    }

    if (data.type === 'GET_HISTORY') {
      const tab = await findChatGPTTab();
      if (tab) {
        try {
          const result = await sendToContentScript(tab.id, { type: 'GET_ACTIVE_CONVERSATION' }, 5000);
          ws.send(JSON.stringify({ type: 'CHATGPT_RESULT', requestId: data.requestId, response: JSON.stringify(result?.messages || []) }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: error.message }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: 'ChatGPT sekmesi bulunamadi' }));
      }
    }

    if (data.type === 'DEBUG') {
      const tab = await findChatGPTTab();
      if (tab) {
        try {
          const result = await sendToContentScript(tab.id, { type: 'DEBUG' }, 5000);
          ws.send(JSON.stringify({
            type: 'CHATGPT_RESULT',
            requestId: data.requestId,
            response: JSON.stringify(result)
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'CHATGPT_RESULT_ERROR',
            requestId: data.requestId,
            error: error.message
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'CHATGPT_RESULT_ERROR',
          requestId: data.requestId,
          error: 'ChatGPT sekmesi bulunamadi'
        }));
      }
    }

    if (data.type === 'UPLOAD_FILE') {
      const tab = await findChatGPTTab();
      if (!tab) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: 'ChatGPT sekmesi bulunamadi' }));
        return;
      }
      try {
        await ensureContentScript(tab.id);
        await sendToContentScript(tab.id, {
          type: 'SEND_FILE',
          data: data.fileData,
          mimeType: data.mimeType || 'application/octet-stream',
          fileName: data.fileName || 'file',
          text: data.text || ''
        }, 30000);
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT', requestId: data.requestId, response: 'Dosya gonderildi: ' + data.fileName }));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: error.message }));
      }
    }

    if (data.type === 'GET_LAST_IMAGES') {
      const tab = await findChatGPTTab();
      if (!tab) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: 'ChatGPT sekmesi bulunamadi' }));
        return;
      }
      try {
        await ensureContentScript(tab.id);
        const result = await sendToContentScript(tab.id, { type: 'GET_LAST_IMAGES' }, 10000);
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT', requestId: data.requestId, response: JSON.stringify(result?.images || []) }));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: error.message }));
      }
    }

    if (data.type === 'DOWNLOAD_IMAGE') {
      const tab = await findChatGPTTab();
      if (!tab) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: 'ChatGPT sekmesi bulunamadi' }));
        return;
      }
      try {
        await ensureContentScript(tab.id);
        const result = await sendToContentScript(tab.id, { type: 'DOWNLOAD_IMAGE', url: data.url }, 30000);
        if (result?.status === 'ok') {
          ws.send(JSON.stringify({
            type: 'CHATGPT_RESULT',
            requestId: data.requestId,
            response: JSON.stringify({ data: result.data, mimeType: result.mimeType, savePath: data.savePath || 'downloads/image.png' })
          }));
        } else {
          ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: result?.error || 'Indirme basarisiz' }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data.requestId, error: error.message }));
      }
    }
    } catch (globalError) {
      console.error('[BG] Global handler error:', globalError.message);
      try { ws.send(JSON.stringify({ type: 'CHATGPT_RESULT_ERROR', requestId: data?.requestId, error: globalError.message })); } catch {}
    }
  };

  ws.onclose = () => {
    console.log('[BG] WebSocket closed');
    ws = null;
    chrome.storage.local.set({ wsStatus: 'disconnected' });
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[BG] WebSocket error:', err.message || err);
    // Hata durumunda da kapatma tetiklenir, onclose zaten scheduleReconnect cagiracak
  };
}

function scheduleReconnect() {
  if (manualDisconnect) return;
  if (!userExplicitConnect) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 3000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'WS_CONNECT') {
    manualDisconnect = false;
    userExplicitConnect = true;
    initialConnectDone = true;
    wsUrl = msg.url || wsUrl;
    connectWebSocket();
    sendResponse({ status: 'connecting' });
    return false;
  }

  if (msg.type === 'WS_DISCONNECT') {
    manualDisconnect = true;
    if (ws) ws.close();
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    chrome.storage.local.set({ wsStatus: 'disconnected' });
    sendResponse({ status: 'disconnected' });
    return false;
  }

  if (msg.type === 'WS_STATUS') {
    sendResponse({
      status: ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'
    });
    return false;
  }

  if (msg.type === 'STREAMING_UPDATE') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'STREAMING_UPDATE', text: msg.text }));
    }
    // Don't sendResponse for fire-and-forget messages
    return false;
  }

  if (msg.type === 'CONTENT_SCRIPT_READY') {
    console.log('[BG] Content script reported ready on tab:', sender.tab?.id);
    return false;
  }

  if (msg.type === 'SERVER_START') {
    sendToNativeHost({ command: 'start' })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (msg.type === 'SERVER_STOP') {
    sendToNativeHost({ command: 'stop' })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (msg.type === 'SERVER_STATUS') {
    sendToNativeHost({ command: 'status' })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ wsStatus: 'disconnected' });
});
