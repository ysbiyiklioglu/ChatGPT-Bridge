#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { createWsServer } from './ws-server.js';
import { DEFAULT_CONFIG } from './types.js';

async function main() {
  const port = parseInt(process.env.WS_PORT || String(DEFAULT_CONFIG.wsPort), 10);
  const host = process.env.WS_HOST || DEFAULT_CONFIG.wsHost;

  const wss = createWsServer(port, host);

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] ChatGPT Bridge MCP server running on stdio');
  console.error(`[MCP] WebSocket server on ws://${host}:${port}`);
  console.error('[MCP] Waiting for Chrome extension to connect...');

  process.on('SIGINT', () => {
    console.error('\n[MCP] Shutting down...');
    wss.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    wss.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
