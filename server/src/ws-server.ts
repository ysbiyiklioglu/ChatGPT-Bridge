import { WebSocketServer, WebSocket } from 'ws';
import type { WSMessage, ChatGPTResult } from './types.js';

let connectedExtension: WebSocket | null = null;
const pendingRequests = new Map<string, {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}>();

export function getExtensionStatus(): { connected: boolean; timestamp: string } {
  return {
    connected: connectedExtension !== null && connectedExtension.readyState === WebSocket.OPEN,
    timestamp: new Date().toISOString()
  };
}

export function isExtensionConnected(): boolean {
  return connectedExtension !== null && connectedExtension.readyState === WebSocket.OPEN;
}

export function createWsServer(port: number, host: string = '127.0.0.1'): WebSocketServer {
  const wss = new WebSocketServer({ port, host });

  wss.on('listening', () => {
    console.error(`[WS] Server listening on ws://${host}:${port}`);
  });

  wss.on('connection', (ws) => {
    console.error('[WS] Chrome extension connected');
    connectedExtension = ws;

    ws.on('message', (data) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.error('[WS] Invalid JSON received');
        return;
      }

      console.error('[WS] Received from extension:', msg.type, msg.requestId || '');

      if (msg.type === 'CHATGPT_RESULT' && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          console.error('[WS] Resolving pending request:', msg.requestId);
          pending.resolve(msg.response || '');
          pendingRequests.delete(msg.requestId);
        } else {
          console.error('[WS] No pending request for:', msg.requestId);
        }
      }

      if (msg.type === 'CHATGPT_RESULT_ERROR' && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          console.error('[WS] Rejecting pending request:', msg.requestId, msg.error);
          pending.reject(new Error(msg.error || 'Unknown error'));
          pendingRequests.delete(msg.requestId);
        }
      }

      if (msg.type === 'STREAMING_UPDATE') {
        console.error(`[WS] Streaming: ${(msg.text || '').substring(0, 50)}...`);
      }
    });

    ws.on('close', () => {
      console.error('[WS] Chrome extension disconnected');
      connectedExtension = null;
      pendingRequests.forEach((pending) => {
        pending.reject(new Error('Extension baglantisi kesildi'));
      });
      pendingRequests.clear();
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  });

  return wss;
}

export function sendToExtension(
  message: WSMessage,
  timeout: number = 60000
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isExtensionConnected()) {
      return reject(new Error('Chrome extension bagli degil. Extension\'i acin ve WebSocket baglantisini kurun.'));
    }

    const requestId = crypto.randomUUID();

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timeout: ${timeout}ms icinde yanit alinamadi`));
    }, timeout);

    pendingRequests.set(requestId, {
      resolve: (text: string) => {
        clearTimeout(timer);
        resolve(text);
      },
      reject: (err: Error) => {
        clearTimeout(timer);
        reject(err);
      }
    });

    connectedExtension!.send(JSON.stringify({
      ...message,
      requestId
    }));
  });
}
