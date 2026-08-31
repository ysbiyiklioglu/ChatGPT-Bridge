# ChatGPT Bridge

Chrome Extension + MCP Server ile ChatGPT web arayuzunu CLI agent'lara baglayan kopru.

## Mimari

```
CLI Agent (opencode) <--stdio--> MCP Server <--WebSocket--> Chrome Extension <--DOM--> ChatGPT
```

## Kurulum

### 1. Bagimliliklari kur

```bash
cd chatgpt-bridge/server
npm install
```

### 2. Chrome Extension'ı yukle

1. `chrome://extensions` adresine git
2. "Developer mode" ac
3. "Load unpacked" tikla
4. `chatgpt-bridge/extension/` klasorunu sec

### 3. Sunucuyu baslat

```bash
cd chatgpt-bridge/server
npm run bridge
```

Veya direkt:
```bash
node server.cjs
```

### 4. ChatGPT'yi Ac

1. https://chatgpt.com adresine git
2. Extension popup'inda WebSocket baglantisini kur (Baglan butonu)

### 5. opencode Yapilandirmasi

`opencode.jsonc` veya `.opencode/config.json` dosyasina ekle:

```json
{
  "mcp": {
    "servers": {
      "chatgpt-bridge": {
        "command": "node",
        "args": ["C:\\Users\\ynbiy\\chatgpt-bridge\\server\\server.cjs"],
        "env": {
          "WS_PORT": "3000"
        }
      }
    }
  }
}
```

## Kullanim

Agent'lara sunulan tool'lar:

| Tool | Aciklama |
|------|----------|
| `chatgpt_send` | ChatGPT'ye mesaj gonder, yaniTI al |
| `chatgpt_status` | Baglanti durumunu kontrol et |
| `chatgpt_new_chat` | Yeni sohbet baslat |
| `chatgpt_history` | Sohbet gecmisini getir |

## Test

Tarayicidan test etmek icin:
```bash
node server.cjs
# Ayri bir terminalde:
curl http://127.0.0.1:3000/status
```

## Notlar

- ChatGPT web arayuzu her guncellendiginde DOM secicileri guncellenmesi gerekebilir
- Extension sadece chatgpt.com ve chat.openai.com domainlerinde calisir
- WebSocket varsayilan olarak port 3000'de dinler
- Sunucu stdio uzerinden MCP protokolu ile iletisim kurar
