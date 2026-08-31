const wsDot = document.getElementById('wsDot');
const wsStatus = document.getElementById('wsStatus');
const chatDot = document.getElementById('chatDot');
const chatStatus = document.getElementById('chatStatus');
const serverDot = document.getElementById('serverDot');
const serverStatus = document.getElementById('serverStatus');
const wsUrlInput = document.getElementById('wsUrl');
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnServerStart = document.getElementById('btnServerStart');
const btnServerStop = document.getElementById('btnServerStop');
const logEl = document.getElementById('log');

function addLog(text, type = '') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateUI(status) {
  if (status === 'connected') {
    wsDot.className = 'status-dot connected';
    wsStatus.textContent = 'Bagli';
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
  } else {
    wsDot.className = 'status-dot disconnected';
    wsStatus.textContent = 'Bagli Degil';
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
  }
}

function updateServerUI(running) {
  if (running) {
    serverDot.className = 'status-dot connected';
    serverStatus.textContent = 'Calisiyor';
    btnServerStart.disabled = true;
    btnServerStop.disabled = false;
  } else {
    serverDot.className = 'status-dot disconnected';
    serverStatus.textContent = 'Durdu';
    btnServerStart.disabled = false;
    btnServerStop.disabled = true;
  }
}

async function checkChatGPTTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://chatgpt.com/*', '*://chat.openai.com/*']
    });
    if (tabs.length > 0) {
      chatDot.className = 'status-dot connected';
      chatStatus.textContent = 'Acik';
    } else {
      chatDot.className = 'status-dot disconnected';
      chatStatus.textContent = 'Kapali';
    }
  } catch {
    chatDot.className = 'status-dot disconnected';
    chatStatus.textContent = 'Kapali';
  }
}

async function checkServerStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SERVER_STATUS' });
    if (response && response.success !== false) {
      updateServerUI(response.running);
    } else {
      updateServerUI(false);
    }
  } catch (e) {
    updateServerUI(false);
  }
}

chrome.storage.local.get('wsStatus', (data) => {
  updateUI(data.wsStatus || 'disconnected');
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wsStatus) {
    updateUI(changes.wsStatus.newValue);
    addLog(`Durum degisti: ${changes.wsStatus.newValue}`,
      changes.wsStatus.newValue === 'connected' ? 'success' : 'error');
  }
});

btnConnect.addEventListener('click', () => {
  const url = wsUrlInput.value.trim();
  if (!url) return;
  addLog(`Baglaniliyor: ${url}`);
  wsDot.className = 'status-dot connecting';
  wsStatus.textContent = 'Baglaniyor...';
  chrome.runtime.sendMessage({ type: 'WS_CONNECT', url });
});

btnDisconnect.addEventListener('click', () => {
  addLog('Baglanti kesiliyor...');
  chrome.runtime.sendMessage({ type: 'WS_DISCONNECT' });
});

btnServerStart.addEventListener('click', async () => {
  addLog('Sunucu baslatiliyor...');
  btnServerStart.disabled = true;
  serverDot.className = 'status-dot connecting';
  serverStatus.textContent = 'Baslatiliyor...';
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SERVER_START' });
    if (response && response.success) {
      if (response.status === 'already_running_port') {
        addLog('Sunucu zaten calisiyor (port 3000 kullaniliyor)', 'success');
        updateServerUI(true);
      } else {
        addLog(`Sunucu baslatildi (PID: ${response.pid})`, 'success');
        updateServerUI(true);
      }
    } else {
      addLog(`Sunucu baslatilamadi: ${response?.error || 'Bilinmeyen hata'}`, 'error');
      updateServerUI(false);
    }
  } catch (e) {
    addLog(`Sunucu baslatma hatasi: ${e.message}`, 'error');
    updateServerUI(false);
  }
});

btnServerStop.addEventListener('click', async () => {
  addLog('Sunucu durduruluyor...');
  btnServerStop.disabled = true;
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SERVER_STOP' });
    addLog(`Durdur sonucu: ${JSON.stringify(response)}`, response?.success ? 'success' : 'error');
    if (response && response.success) {
      updateServerUI(false);
      chrome.runtime.sendMessage({ type: 'WS_DISCONNECT' });
    } else {
      updateServerUI(true);
    }
  } catch (e) {
    addLog(`Sunucu durdurma hatasi: ${e.message}`, 'error');
  }
});

checkChatGPTTab();
checkServerStatus();
