# ChatGPT Bridge

Chrome Extension + MCP Server ile ChatGPT web arayuzunu CLI agent'lara baglayan kopru.

## Mimari

```
CLI Agent (opencode) <--stdio--> MCP Server <--WebSocket--> Chrome Extension <--DOM--> ChatGPT
```

## Kurulum

### 1. Bagimliliklari kur

```bash
cd server
npm install
```

### 2. Native Host kur

```bash
cd native-host
install-host.bat
```

Sonra `com.chatgpt.bridge.json` dosyasini acin ve `PLACEHOLDER_EXTENSION_ID` degerini kendi extension ID'niz ile degistirin.
Extension ID'yi ogrenmek icin: `chrome://extensions`

### 3. Chrome Extension'i yukle

1. `chrome://extensions` adresine git
2. "Developer mode" ac
3. "Load unpacked" tikla
4. `extension/` klasorunu sec

### 4. Sunucuyu baslat

```bash
cd server
node server.cjs
```

Veya extension popup'indan "Sunucu Baslat" butonuna basin.

### 5. ChatGPT'yi Ac

1. https://chatgpt.com adresine git
2. Extension popup'inda WebSocket baglantisini kur (Baglan butonu)

### 6. opencode Yapilandirmasi

`opencode.jsonc` dosyasina ekle:

```json
{
  "mcp": {
    "servers": {
      "chatgpt-bridge": {
        "command": "node",
        "args": ["C:\\Users\\KULLANICI\\chatgpt-bridge\\server\\server.cjs"],
        "env": {
          "WS_PORT": "3000"
        },
        "timeout": 620000
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
| `chatgpt_quick` | Hizli aksiyon: ozetle, cevir, acikla, kod incele |
| `chatgpt_status` | Baglanti durumunu kontrol et |
| `chatgpt_new_chat` | Yeni sohbet baslat |
| `chatgpt_history` | Sohbet gecmisini getir |
| `chatgpt_upload` | Bilgisayardan dosya secip ChatGPT'ye yukle |
| `chatgpt_images` | Son cevaptaki resimleri listele |
| `chatgpt_download` | Resim/dosyayi bilgisayara indir |

## Dosya Yapisi

```
chatgpt-bridge/
  extension/          # Chrome Extension
    background/       # Service worker (WS baglantisi)
    content/          # Content script (DOM etkilesimi)
    popup/            # Popup UI
    manifest.json
  server/             # MCP + HTTP + WebSocket sunucusu
    server.cjs
    package.json
  native-host/        # Chrome Native Messaging host
    host.js
    host.bat
    install-host.bat
```

## Notlar

- ChatGPT web arayuzu her guncellendiginde DOM secicileri guncellenmesi gerekebilir
- Extension sadece chatgpt.com ve chat.openai.com domainlerinde calisir
- WebSocket varsayilan olarak port 3000'de dinler
- Sunucu stdio uzerinden MCP protokolu ile iletisim kurar
- Dosya indirme ChatGPT'nin cookie'leriyle yapilir (oturum acik olmali)
