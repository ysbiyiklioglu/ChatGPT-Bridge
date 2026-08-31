import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendToExtension, getExtensionStatus } from './ws-server.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'chatgpt-bridge',
    version: '1.0.0'
  });

  server.tool(
    'chatgpt-send',
    'ChatGPT web arayuzune mesaj gonderir ve yaniTI bekler. Chatgpt.com acik olmali.',
    {
      message: z.string().describe('ChatGPT\'ye gonderilecek mesaj'),
      timeout: z.number().optional().default(60000).describe('Yanit bekleme suresi (ms)')
    },
    async ({ message, timeout }) => {
      try {
        const response = await sendToExtension(
          { type: 'SEND_MESSAGE', text: message, timeout },
          timeout
        );
        return {
          content: [{
            type: 'text' as const,
            text: response
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Hata: ${errMsg}`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'chatgpt-status',
    'ChatGPT Chrome eklentisi ve WebSocket baglantisinin durumunu kontrol eder.',
    {},
    async () => {
      const status = getExtensionStatus();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(status, null, 2)
        }]
      };
    }
  );

  server.tool(
    'chatgpt-new-chat',
    'ChatGPT\'de yeni sohbet baslatir.',
    {},
    async () => {
      try {
        await sendToExtension({ type: 'NEW_CHAT' }, 10000);
        return {
          content: [{
            type: 'text' as const,
            text: 'Yeni sohbet baslatildi'
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Hata: ${errMsg}`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'chatgpt-history',
    'Mevcut sohbetin gecmisini getirir.',
    {},
    async () => {
      try {
        const result = await sendToExtension({ type: 'GET_HISTORY' }, 10000);
        const history = JSON.parse(result);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(history, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Hata: ${errMsg}`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    'chatgpt-debug',
    'Debug: Chrome extension ve ChatGPT DOM durumunu kontrol eder.',
    {},
    async () => {
      try {
        const status = getExtensionStatus();
        if (!status.connected) {
          return {
            content: [{
              type: 'text' as const,
              text: 'WebSocket baglantisi yok. Extension\'i acin ve baglanin.'
            }],
            isError: true
          };
        }

        const result = await sendToExtension({ type: 'PING' }, 5000);
        const parsed = JSON.parse(result);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              wsConnected: true,
              chatgptTabFound: parsed.tabFound,
              contentScriptLoaded: parsed.contentScriptAlive
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Debug Hata: ${errMsg}`
          }],
          isError: true
        };
      }
    }
  );

  return server;
}
