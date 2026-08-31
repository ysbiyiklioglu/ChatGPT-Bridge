#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let serverProcess = null;
let serverPid = null;

// Server path: check config file first, then fall back to relative path
function getServerPath() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.serverPath && fs.existsSync(config.serverPath)) {
      return config.serverPath;
    }
  } catch {}
  return path.join(__dirname, '..', 'server', 'server.cjs');
}

const SERVER_PATH = getServerPath();
const PID_FILE = path.join(path.dirname(SERVER_PATH), 'server.pid');

function savePid(pid) {
  try { fs.writeFileSync(PID_FILE, String(pid), 'utf8'); } catch {}
}

function readPid() {
  try { return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch { return null; }
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sendResponse(response) {
  const json = JSON.stringify(response);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

function readMessage() {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let bytesRead = 0;

    function readChunk() {
      const remaining = 4 - bytesRead;
      const chunk = process.stdin.read(remaining);
      if (!chunk) {
        process.stdin.once('readable', readChunk);
        return;
      }
      chunk.copy(header, bytesRead);
      bytesRead += chunk.length;
      if (bytesRead < 4) {
        readChunk();
        return;
      }
      const msgLen = header.readUInt32LE(0);
      const msgBuf = Buffer.alloc(msgLen);
      let msgRead = 0;

      function readMsg() {
        const chunk = process.stdin.read(msgLen - msgRead);
        if (!chunk) {
          process.stdin.once('readable', readMsg);
          return;
        }
        chunk.copy(msgBuf, msgRead);
        msgRead += chunk.length;
        if (msgRead < msgLen) {
          readMsg();
          return;
        }
        try {
          resolve(JSON.parse(msgBuf.toString('utf8')));
        } catch (e) {
          reject(e);
        }
      }
      readMsg();
    }
    readChunk();
  });
}

function checkPort() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get('http://127.0.0.1:3000/status', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    return { status: 'already_running', pid: existingPid };
  }
  removePid();

  const portInUse = await checkPort();
  if (portInUse) {
    return { status: 'already_running_port', message: 'Port 3000 kullaniliyor, sunucu zaten calisiyor' };
  }

  return new Promise((resolve, reject) => {
    try {
      serverProcess = spawn('node', [SERVER_PATH], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, WS_PORT: '3000' }
      });

      serverPid = serverProcess.pid;
      savePid(serverPid);
      serverProcess.unref();

      serverProcess.on('error', (err) => {
        serverProcess = null;
        serverPid = null;
        removePid();
        reject(new Error('Sunucu baslatilamadi: ' + err.message));
      });

      serverProcess.on('exit', (code) => {
        serverProcess = null;
        serverPid = null;
        removePid();
      });

      setTimeout(() => {
        resolve({ status: 'started', pid: serverPid });
      }, 1500);
    } catch (e) {
      reject(new Error('Sunucu baslatilamadi: ' + e.message));
    }
  });
}

function findPidByPort(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    const { exec } = require('child_process');
    exec(`netstat -ano | findstr :${port} | findstr LISTENING`, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid > 0 && !isNaN(pid)) {
          resolve(pid);
          return;
        }
      }
      resolve(null);
    });
  });
}

function killProcess(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec(`taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
        resolve({ success: !err, error: err ? err.message : null, stdout, stderr });
      });
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch {}
      setTimeout(() => {
        if (isProcessRunning(pid)) {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
        resolve({ success: true });
      }, 2000);
    }
  });
}

function stopServer() {
  return new Promise(async (resolve) => {
    let pid = readPid();
    
    if (!pid || !isProcessRunning(pid)) {
      pid = await findPidByPort(3000);
    }

    if (!pid || !isProcessRunning(pid)) {
      removePid();
      resolve({ status: 'not_running', message: 'Calisan sunucu processi bulunamadi' });
      return;
    }

    const result = await killProcess(pid);
    removePid();
    
    await new Promise(r => setTimeout(r, 1000));
    
    const stillRunning = await findPidByPort(3000);
    resolve({ status: stillRunning ? 'failed' : 'stopped', pid, killResult: result });
  });
}

function checkStatus() {
  return new Promise(async (resolve) => {
    let pid = readPid();
    if (!pid || !isProcessRunning(pid)) {
      pid = await findPidByPort(3000);
    }
    const pidAlive = pid ? isProcessRunning(pid) : false;
    
    const http = require('http');
    const req = http.get('http://127.0.0.1:3000/status', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          resolve({
            running: true,
            pid: pid || null,
            extensionConnected: status.extensionConnected,
            pendingRequests: status.pendingRequests
          });
        } catch {
          resolve({ running: pidAlive, pid: pid || null, extensionConnected: false });
        }
      });
    });

    req.on('error', () => {
      if (pidAlive) {
        resolve({ running: true, pid, extensionConnected: false });
      } else {
        removePid();
        resolve({ running: false, pid: null, extensionConnected: false });
      }
    });

    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ running: pidAlive, pid: pid || null, extensionConnected: false });
    });
  });
}

async function main() {
  try {
    const message = await readMessage();

    switch (message.command) {
      case 'start': {
        const result = await startServer();
        sendResponse({ success: true, ...result });
        break;
      }
      case 'stop': {
        const result = await stopServer();
        sendResponse({ success: true, ...result });
        break;
      }
      case 'status': {
        const result = await checkStatus();
        sendResponse({ success: true, ...result });
        break;
      }
      default:
        sendResponse({ success: false, error: 'Bilinmeyen komut: ' + message.command });
    }
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }

  process.exit(0);
}

main();
