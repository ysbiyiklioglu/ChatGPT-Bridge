export interface WSMessage {
  type: string;
  requestId?: string;
  text?: string;
  timeout?: number;
  response?: string;
  error?: string;
  history?: Array<{ role: string; content: string }>;
  status?: string;
}

export interface ChatGPTResult {
  requestId: string;
  response?: string;
  error?: string;
}

export interface ServerConfig {
  wsPort: number;
  wsHost: string;
}

export const DEFAULT_CONFIG: ServerConfig = {
  wsPort: 3000,
  wsHost: '127.0.0.1'
};
