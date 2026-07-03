// Electron main process for 704 Minesweeper.
// Spawns the Node server as a child (using Electron-as-Node so no external node binary needed),
// waits for it to listen, then opens controller window. Broadcast button in the controller
// opens a projector BrowserWindow on the selected display (or windowed for OBS/NDI capture).

const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const osc = require('osc');

const SERVER_PORT = Number(process.env.PORT ?? 3000);
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CONTROLLER_URL = `${SERVER_URL}/?face=all`;
const PROJECTOR_URL = `${SERVER_URL}/?face=all&projector=1`;

// TouchOSC / OSC control — same flow as 704_GenerativeArt (UDP listener in
// Electron main), but on port 9001 so it doesn't clash with GA when both
// exe are running on the same operator laptop. Address prefix /704mine/…
// distinguishes from GA's /704art/… namespace.
const OSC_PORT = Number(process.env.OSC_PORT ?? 9001);
let oscPort = null;

const ROOT = path.join(__dirname, '..');
const SERVER_SCRIPT = path.join(ROOT, 'server', 'index.js');

let serverProcess = null;
let controllerWindow = null;
let projectorWindow = null;

function log(...a) { console.log('[electron]', ...a); }

// ── Server child process ───────────────────────────────────────

function spawnServer() {
  // Use Electron as Node via ELECTRON_RUN_AS_NODE so we don't need an external node binary
  // (works when packaged as portable exe).
  serverProcess = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(SERVER_PORT),
    },
  });
  serverProcess.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code, signal) => {
    log(`server exited code=${code} signal=${signal}`);
    serverProcess = null;
    if (code !== 0 && code !== null) {
      // server died unexpectedly → quit the app so user notices
      if (app.isReady()) app.quit();
    }
  });
}

function waitForServer(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryPing = () => {
      const req = http.get(`${SERVER_URL}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', () => retry());
      req.setTimeout(800, () => { req.destroy(); retry(); });
    };
    function retry() {
      if (Date.now() - start > timeoutMs) return reject(new Error('server start timeout'));
      setTimeout(tryPing, 200);
    }
    tryPing();
  });
}

// ── Screen / display detection ─────────────────────────────────

function listDisplayInfos() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    bounds: d.bounds,
    workArea: d.workArea,
    size: d.size,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
  }));
}

function pickSecondaryDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(d => d.id !== primary.id) || primary;
}

function resolveDisplay(displayId) {
  if (displayId != null) {
    const match = screen.getAllDisplays().find(d => d.id === displayId);
    if (match) return match;
  }
  return pickSecondaryDisplay();
}

// ── Windows ────────────────────────────────────────────────────

function createControllerWindow() {
  controllerWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0a0a0a',
    title: '704 Minesweeper — 控制台',
    autoHideMenuBar: true,
    show: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  controllerWindow.loadURL(CONTROLLER_URL);
  controllerWindow.once('ready-to-show', () => {
    if (!controllerWindow || controllerWindow.isDestroyed()) return;
    controllerWindow.show();
    controllerWindow.focus();
    controllerWindow.moveTop();
  });
  controllerWindow.on('closed', () => {
    controllerWindow = null;
    // 控制台關掉 = 整個遊戲關掉,投影窗也一起收
    // (不然 projector 還活著,window-all-closed 不會 fire,app 留在背景沒 UI)
    closeProjector();
  });
  controllerWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`controller load failed: ${code} ${desc} ${url}`);
  });
}

function sendProjectorState() {
  const isOpen = !!(projectorWindow && !projectorWindow.isDestroyed());
  if (controllerWindow && !controllerWindow.isDestroyed()) {
    controllerWindow.webContents.send('projector:state', isOpen);
  }
}

function closeProjector() {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.close();
  }
  projectorWindow = null;
}

function openProjector({ displayId, windowed }) {
  closeProjector();

  let browserOptions;
  if (windowed) {
    const primary = screen.getPrimaryDisplay();
    const w = 700, h = 1000;
    browserOptions = {
      x: primary.bounds.x + Math.max(40, primary.bounds.width - w - 40),
      y: primary.bounds.y + 40,
      width: w,
      height: h,
      minWidth: 360,
      minHeight: 480,
      title: '704 Minesweeper Projector — capture this window',
      frame: true,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      resizable: true,
    };
  } else {
    const display = resolveDisplay(displayId);
    browserOptions = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: true,
      frame: false,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
    };
  }

  projectorWindow = new BrowserWindow({
    ...browserOptions,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  projectorWindow.loadURL(PROJECTOR_URL);

  // ESC to close projector
  projectorWindow.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      e.preventDefault();
      closeProjector();
    }
  });

  projectorWindow.once('ready-to-show', () => {
    if (!projectorWindow || projectorWindow.isDestroyed()) return;
    projectorWindow.show();
    if (!windowed) projectorWindow.setFullScreen(true);
  });

  projectorWindow.on('closed', () => {
    projectorWindow = null;
    sendProjectorState();
  });

  sendProjectorState();
}

// ── IPC handlers ────────────────────────────────────────────────

ipcMain.handle('displays:list', () => listDisplayInfos());
ipcMain.handle('projector:open',  (_e, opts) => { openProjector(opts ?? {}); return true; });
ipcMain.handle('projector:close', () => { closeProjector(); return true; });
ipcMain.handle('projector:isOpen', () => !!(projectorWindow && !projectorWindow.isDestroyed()));
ipcMain.handle('projector:openSecondary', () => {
  // shortcut: auto-pick non-primary display, fullscreen
  openProjector({ displayId: pickSecondaryDisplay().id, windowed: false });
  return true;
});

// ── TouchOSC / OSC listener ─────────────────────────────────────
//
// Mirror 704_GenerativeArt's flow: iPad running TouchOSC sends UDP OSC
// messages to <laptop IP>:9001, this listener routes them to the same
// openProjector() / closeProjector() functions the on-screen Broadcast
// button uses. Deliberately silent on unknown addresses so the layout
// can share templates with GA without spamming the log.
//
// Namespaces:
//   /704mine/projector/windowed    → open windowed projector (NDI/OBS capture)
//   /704mine/projector/secondary   → open fullscreen on second display
//   /704mine/projector/close       → close projector
//   /704mine/projector/toggle      → close if open, else open secondary
//   /704mine/ping                  → log-only, useful for testing TouchOSC connectivity

function startOSC() {
  if (oscPort) return;
  oscPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: OSC_PORT,
    metadata: false,
  });
  oscPort.on('ready', () => {
    log(`OSC listening on udp://0.0.0.0:${OSC_PORT}`);
  });
  oscPort.on('message', (oscMsg) => {
    const addr = String(oscMsg.address || '');
    const args = oscMsg.args || [];
    // TouchOSC 有些控件按下、放開都送(第一個 arg = 1 / 0),忽略 0 免得重複觸發
    const primaryVal = args.length > 0 ? args[0] : null;
    if (primaryVal === 0 || primaryVal === 0.0) return;
    log(`OSC <- ${addr} ${JSON.stringify(args)}`);
    handleOSC(addr, args);
  });
  oscPort.on('error', (err) => {
    log('OSC error:', err && err.message ? err.message : err);
  });
  try {
    oscPort.open();
  } catch (e) {
    log('OSC open() failed:', e && e.message ? e.message : e);
  }
}

function stopOSC() {
  if (!oscPort) return;
  try { oscPort.close(); } catch {}
  oscPort = null;
}

function handleOSC(addr, args) {
  switch (addr) {
    case '/704mine/projector/windowed':
      openProjector({ windowed: true });
      break;
    case '/704mine/projector/secondary':
      openProjector({ displayId: pickSecondaryDisplay().id, windowed: false });
      break;
    case '/704mine/projector/close':
      closeProjector();
      break;
    case '/704mine/projector/toggle':
      if (projectorWindow && !projectorWindow.isDestroyed()) {
        closeProjector();
      } else {
        openProjector({ displayId: pickSecondaryDisplay().id, windowed: false });
      }
      break;
    case '/704mine/ping':
      // no-op — presence in the log is the point
      break;
    default:
      // silent — TouchOSC template might have other addresses
      break;
  }
}

// ── App lifecycle ───────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controllerWindow) {
      if (controllerWindow.isMinimized()) controllerWindow.restore();
      controllerWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  spawnServer();
  try {
    await waitForServer();
    log('server ready, opening controller window');
  } catch (e) {
    log('server failed to start:', e.message);
    app.quit();
    return;
  }
  createControllerWindow();
  startOSC();
});

app.on('window-all-closed', () => {
  // On macOS apps usually stay open. For our venue use case, quit when controller closes.
  app.quit();
});

app.on('before-quit', () => {
  closeProjector();
  stopOSC();
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
