// ChatGPT Bridge - Content Script
(() => {
  console.log('[ChatGPT Bridge] Loading on:', window.location.href);

  // ChatObserver
  class ChatObserver {
    constructor() { this.listeners = []; this.observer = null; }
    start() {
      if (this.observer) return;
      const target = document.querySelector('main') || document.body;
      this.observer = new MutationObserver((mutations) => {
        this.listeners.forEach(cb => cb(mutations));
      });
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
    }
    onMessage(callback) { this.listeners.push(callback); }
    stop() { if (this.observer) { this.observer.disconnect(); this.observer = null; } }
  }

  // ChatGPTBridge
  const ChatGPTBridge = {
    _conversationHistory: [],
    _maxHistory: 20,
    _wait: (ms) => new Promise(r => setTimeout(r, ms)),
    
    _findElement(selectors) {
      for (const sel of selectors) {
        try { const el = document.querySelector(sel); if (el) return el; } catch {}
      }
      return null;
    },
    
    _findAllElements(selectors) {
      for (const sel of selectors) {
        try { const els = document.querySelectorAll(sel); if (els.length > 0) return Array.from(els); } catch {}
      }
      return [];
    },
    
    _getLastAssistantMessage() {
      const selectors = [
        '[data-message-author-role="assistant"]',
        'div.agent-turn div.markdown',
        'div[data-message-author-role="assistant"]',
        '.markdown-inner'
      ];
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const lastEl = els[els.length - 1];
            const text = (lastEl.textContent || '').trim();
            if (text && text.length > 10) return lastEl;
          }
        } catch {}
      }
      try {
        const allMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
        for (let i = allMsgs.length - 1; i >= 0; i--) {
          const text = (allMsgs[i].textContent || '').trim();
          if (text && text.length > 10) return allMsgs[i];
        }
      } catch {}
      return null;
    },

    async sendMessage(text) {
      const inputArea = this._findElement([
        '#prompt-textarea', 'div[contenteditable="true"][id="prompt-textarea"]',
        'div[contenteditable="true"]', 'textarea[placeholder*="Message"]', '[role="textbox"]'
      ]);
      if (!inputArea) {
        console.error('[Bridge] Input alani bulunamadi!');
        throw new Error('Input alani bulunamadi');
      }
      console.log('[Bridge] Input found: ' + inputArea.tagName + '#' + inputArea.id);

      this._preSendAssistantCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
      console.log('[Bridge] Pre-send assistant count: ' + this._preSendAssistantCount);

      inputArea.focus();
      await this._wait(100);
      
      // Contenteditable div icin dogru yontem
      inputArea.innerHTML = '';
      document.execCommand('insertText', false, text);
      inputArea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      await this._wait(300);

      const sendBtn = this._findElement([
        'button[data-testid="send-button"]', 'button[aria-label*="Send"]', 'form button[type="submit"]'
      ]);
      if (sendBtn) {
        console.log('[Bridge] Send button found, clicking...');
        sendBtn.click();
      } else {
        console.log('[Bridge] No send button found, pressing Enter');
        inputArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }

      this._conversationHistory.push({ role: 'user', content: text, timestamp: Date.now() });
      return true;
    },

    async waitForResponse(timeout = 600000) {
      const startTime = Date.now();
      console.log('[Bridge] waitForResponse started, timeout=' + timeout);
      await this._wait(2000);

      // 1. Asama: Dur butonunun cikmasini bekle (yazmaya basladi)
      let stopBtnFound = false;
      while (Date.now() - startTime < timeout) {
        const stopBtn = document.querySelector('button[aria-label="Stop generating"]') 
          || document.querySelector('button[data-testid="stop-button"]');
        if (stopBtn) {
          console.log('[Bridge] Stop button found after ' + (Date.now() - startTime) + 'ms');
          stopBtnFound = true;
          break;
        }
        // Hizli yanit icin: dur butonu hic cikmadan bittiyse
        const allAssistant = document.querySelectorAll('[data-message-author-role="assistant"]');
        const preCount = this._preSendAssistantCount || 0;
        if (allAssistant.length > preCount) {
          const lastMsg = allAssistant[allAssistant.length - 1];
          const text = (lastMsg.textContent || '').trim();
          if (text && text.length > 10) {
            console.log('[Bridge] Quick response detected (new msg), waiting 5s for stabilization...');
            await this._wait(5000);
            const finalMsg = allAssistant[allAssistant.length - 1];
            if (finalMsg) {
              const finalText = (finalMsg.textContent || '').trim();
              if (finalText) {
                console.log('[Bridge] Quick response done, len=' + finalText.length);
                this._conversationHistory.push({ role: 'assistant', content: finalText, timestamp: Date.now() });
                return finalText;
              }
            }
          }
        }
        await this._wait(500);
      }

      if (!stopBtnFound) {
        console.log('[Bridge] No stop button found, checking for new response...');
        const allAssistant = document.querySelectorAll('[data-message-author-role="assistant"]');
        const preCount = this._preSendAssistantCount || 0;
        if (allAssistant.length > preCount) {
          const finalMsg = allAssistant[allAssistant.length - 1];
          const finalText = (finalMsg.textContent || '').trim();
          if (finalText) {
            this._conversationHistory.push({ role: 'assistant', content: finalText, timestamp: Date.now() });
            return finalText;
          }
        }
        throw new Error('Yanit alinamadi');
      }

      // 2. Asama: Dur butonunun kaybolmasini bekle (yazmamis bitti)
      console.log('[Bridge] Waiting for stop button to disappear...');
      while (Date.now() - startTime < timeout) {
        const stopBtn = document.querySelector('button[aria-label="Stop generating"]') 
          || document.querySelector('button[data-testid="stop-button"]');
        if (!stopBtn) {
          console.log('[Bridge] Stop button disappeared after ' + (Date.now() - startTime) + 'ms');
          break;
        }
        await this._wait(500);
      }

      // 3. Asama: Metnin tam oturmasini bekle (degisim olmamali)
      console.log('[Bridge] Waiting for text stabilization...');
      let lastText = '';
      let stableCount = 0;
      while (Date.now() - startTime < timeout) {
        const finalMsg = this._getLastAssistantMessage();
        if (finalMsg) {
          const currentText = (finalMsg.textContent || '').trim();
          if (currentText === lastText && currentText.length > 10) {
            stableCount++;
            if (stableCount >= 6) {
              console.log('[Bridge] Text stable after ' + (Date.now() - startTime) + 'ms, len=' + currentText.length);
              this._conversationHistory.push({ role: 'assistant', content: currentText, timestamp: Date.now() });
              return currentText;
            }
          } else {
            stableCount = 0;
            lastText = currentText;
          }
        }
        await this._wait(1000);
      }

      console.log('[Bridge] Timeout reached, returning last known text');
      const finalMsg = this._getLastAssistantMessage();
      if (finalMsg) {
        const finalText = (finalMsg.textContent || '').trim();
        if (finalText) {
          this._conversationHistory.push({ role: 'assistant', content: finalText, timestamp: Date.now() });
          return finalText;
        }
      }
      throw new Error('Yanit alinamadi');
    },

    async startNewChat() {
      if (window.location.pathname !== '/') {
        window.location.href = 'https://chatgpt.com/';
        await this._wait(2000);
        return true;
      }
      const btn = this._findElement(['a[href="/"]', 'nav a[href="/"]']);
      if (btn) { btn.click(); await this._wait(1000); return true; }
      throw new Error('Yeni sohbet butonu bulunamadi');
    },

    async getConversationHistory() {
      return [...this._conversationHistory];
    },

    getActiveConversation() {
      const messages = [];
      const allMsgs = document.querySelectorAll('[data-message-author-role]');
      for (const el of allMsgs) {
        const role = el.getAttribute('data-message-author-role');
        const text = (el.textContent || '').trim();
        if (text && text.length > 0) {
          messages.push({ role, content: text });
        }
      }
      return messages;
    },

    async pasteFileToInput(fileBlob, fileName) {
      const inputArea = this._findElement([
        '#prompt-textarea', 'div[contenteditable="true"][id="prompt-textarea"]',
        'div[contenteditable="true"]', '[role="textbox"]'
      ]);
      if (!inputArea) throw new Error('Input alani bulunamadi');

      const file = new File([fileBlob], fileName, { type: fileBlob.type });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });

      inputArea.focus();
      await this._wait(200);
      inputArea.dispatchEvent(pasteEvent);
      await this._wait(1000);

      const img = inputArea.querySelector('img');
      if (img) {
        console.log('[Bridge] Image pasted successfully');
        return true;
      }
      console.log('[Bridge] Image paste attempted (may need manual check)');
      return true;
    }
  };

  window.ChatGPTBridge = ChatGPTBridge;
  window.ChatObserver = ChatObserver;

  // Bridge
  const observer = new ChatObserver();
  observer.start();
  observer.onMessage(() => {
    const lastMsg = ChatGPTBridge._getLastAssistantMessage();
    if (lastMsg) {
      const text = (lastMsg.textContent || '').trim();
      try { chrome.runtime.sendMessage({ type: 'STREAMING_UPDATE', text }); } catch {}
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[Bridge] Message:', msg.type);

    if (msg.type === 'PING') { sendResponse({ status: 'alive' }); return false; }

    if (msg.type === 'POLL_RESULT') {
      const pending = window.__chatgptBridgePending;
      const result = window.__chatgptBridgeResult;
      const error = window.__chatgptBridgeError;
      sendResponse({ pending, result: result || null, error: error || null });
      return false;
    }

    if (msg.type === 'SEND_MESSAGE') {
      console.log('[Bridge] SEND_MESSAGE received, text=' + (msg.text||'').substring(0, 50) + ' timeout=' + msg.timeout);
      window.__chatgptBridgePending = true;
      window.__chatgptBridgeResult = null;
      window.__chatgptBridgeError = null;

      ChatGPTBridge.sendMessage(msg.text)
        .then(() => {
          console.log('[Bridge] sendMessage done, waiting for response...');
          return ChatGPTBridge.waitForResponse(msg.timeout || 600000);
        })
        .then(response => {
          console.log('[Bridge] waitForResponse done, responseLen=' + (response||'').length);
          window.__chatgptBridgeResult = response;
          window.__chatgptBridgePending = false;
        })
        .catch(error => {
          console.error('[Bridge] SEND_MESSAGE error:', error.message);
          window.__chatgptBridgeError = error.message;
          window.__chatgptBridgePending = false;
        });

      sendResponse({ status: 'started' });
      return false;
    }

    if (msg.type === 'NEW_CHAT') {
      ChatGPTBridge.startNewChat()
        .then(() => sendResponse({ status: 'ok' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }

    if (msg.type === 'GET_HISTORY') {
      ChatGPTBridge.getConversationHistory()
        .then(history => sendResponse({ status: 'ok', history }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }

    if (msg.type === 'GET_ACTIVE_CONVERSATION') {
      try {
        const messages = ChatGPTBridge.getActiveConversation();
        sendResponse({ status: 'ok', messages });
      } catch (error) {
        sendResponse({ status: 'error', error: error.message });
      }
      return false;
    }

    if (msg.type === 'SEND_FILE') {
      console.log('[Bridge] SEND_FILE received, fileName=' + msg.fileName);
      const base64 = msg.data;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: msg.mimeType || 'application/octet-stream' });

      ChatGPTBridge.pasteFileToInput(blob, msg.fileName || 'file')
        .then(ok => {
          if (msg.text) {
            return ChatGPTBridge.sendMessage(msg.text).then(() => ok);
          }
          return ok;
        })
        .then(ok => sendResponse({ status: 'ok' }))
        .catch(error => sendResponse({ status: 'error', error: error.message }));
      return true;
    }

    if (msg.type === 'GET_LAST_IMAGES') {
      try {
        const images = [];
        const agentTurns = document.querySelectorAll('div.agent-turn');
        const lastMsg = agentTurns[agentTurns.length - 1];
        if (lastMsg) {
          const imgs = lastMsg.querySelectorAll('img, canvas, svg, [data-image], [src]');
          for (const img of imgs) {
            const src = img.src || img.getAttribute('src') || '';
            const tag = img.tagName.toLowerCase();
            if (src && src.startsWith('http')) {
              images.push({ src, alt: img.alt || '', tag });
            } else if (tag === 'canvas') {
              try {
                const dataUrl = img.toDataURL('image/png');
                images.push({ src: dataUrl, alt: 'canvas', tag });
              } catch (e) {}
            }
          }
          if (images.length === 0) {
            const allImgs = document.querySelectorAll('img');
            for (const img of allImgs) {
              const src = img.src || '';
              if (src && src.startsWith('http')) {
                images.push({ src, alt: img.alt || '', tag: 'img' });
              }
            }
          }
        }
        sendResponse({ status: 'ok', images });
      } catch (error) {
        sendResponse({ status: 'error', error: error.message });
      }
      return false;
    }

    if (msg.type === 'DOWNLOAD_IMAGE') {
      (async () => {
        try {
          const response = await fetch(msg.url);
          const blob = await response.blob();
          const reader = new FileReader();
          const base64 = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          sendResponse({ status: 'ok', data: base64, mimeType: blob.type });
        } catch (error) {
          sendResponse({ status: 'error', error: error.message });
        }
      })();
      return true;
    }

    if (msg.type === 'DEBUG') {
      const selectors = {
        'data-message-author-role=assistant': document.querySelectorAll('[data-message-author-role="assistant"]').length,
        'div.agent-turn': document.querySelectorAll('div.agent-turn').length,
        'div.agent-turn div.markdown': document.querySelectorAll('div.agent-turn div.markdown').length,
        '.markdown': document.querySelectorAll('.markdown').length,
        '.markdown-inner': document.querySelectorAll('.markdown-inner').length,
        'article': document.querySelectorAll('article').length,
        '[data-message-author-role]': document.querySelectorAll('[data-message-author-role]').length,
        'main > div > div': document.querySelectorAll('main > div > div').length,
      };
      const allMsgRoles = document.querySelectorAll('[data-message-author-role]');
      const roles = Array.from(allMsgRoles).map(el => el.getAttribute('data-message-author-role'));
      
      const lastMsg = ChatGPTBridge._getLastAssistantMessage();
      const lastMsgText = lastMsg ? (lastMsg.textContent || '').substring(0, 200) : null;
      
      sendResponse({ 
        status: 'ok', 
        selectors, 
        roles,
        lastMsgText,
        url: window.location.href,
        title: document.title
      });
      return false;
    }
  });

  // Signal ready after listener is registered
  try { chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }); } catch {}
  console.log('[ChatGPT Bridge] Loaded successfully!');
})();
