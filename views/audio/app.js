import { audioConfig } from './config.js';
import { AudioEngine } from './engine.js';
import { AudioRouter } from './router.js';
import { PlaybackLease } from './lease.js';

const $ = id => document.getElementById(id);
const phaseNames = {
  idle: '外部待機', armed: '等待玩家開始', intro: '前導動畫', ready: '等待 PLAY',
  tutorial: '教學', tutorialReady: '教學完成', countdown: '開場倒數',
  playing: '遊戲進行中', paused: '暫停操作', gameOver: '本回合結束',
  'win-ending': '過關結尾', 'timeout-wave': '時間到・等待繼續',
  'timeout-ending': '逾時結尾', 'operator-ending': '操作員結束',
};
let loaded = new Set();
let active = false;
let enabling = false;
let disposed = false;
let socket;
let reconnectTimer;
let retry = 0;
let session = 0;
const lease = new PlaybackLease();

function log(type, text) {
  const row = document.createElement('tr');
  for (const value of [new Date().toLocaleTimeString('zh-TW', { hour12: false }), type, text]) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  $('event-log').prepend(row);
  while ($('event-log').children.length > 60) $('event-log').lastChild.remove();
}

function notice(text, error = false) {
  $('notice').textContent = text;
  $('notice').dataset.error = String(error);
}

const engine = new AudioEngine(audioConfig, (type, value) => {
  if (type === 'error') { notice(value, true); log('音源錯誤', value); }
  if (type === 'loaded') {
    loaded.add(value);
    $('loaded').textContent = `${loaded.size} / ${Object.keys(audioConfig.sounds).length}`;
  }
  if (type === 'music') $('music').textContent = value || '無';
  if (type === 'context' && value !== 'running' && active) {
    deactivate('瀏覽器暫停了音訊，請再次點擊啟用聲音。');
  }
});
const router = new AudioRouter(audioConfig, engine, (event, sound, enabled) => {
  log(enabled ? '音效觸發' : '音效預覽（未啟用）', `${event} → ${sound}`);
});

function paintControls() {
  $('enable').disabled = active || enabling;
  $('enable').textContent = enabling ? '正在啟用…' : '啟用聲音';
  $('stop').disabled = !active;
  $('output-state').textContent = active ? '已啟用' : '未啟用';
  $('output-state').dataset.on = String(active);
  for (const button of document.querySelectorAll('[data-sound]')) button.disabled = !active;
}

function deactivate(text) {
  session++;
  active = false;
  enabling = false;
  router.disable();
  engine.disable();
  lease.release();
  paintControls();
  notice(text);
}

$('enable').addEventListener('click', async () => {
  if (active || enabling) return;
  enabling = true;
  const token = ++session;
  paintControls();
  try {
    // 必須從人工點擊呼叫 resume。尚未取得互斥權前，不啟動任何聲音。
    const unlocking = engine.unlock();
    unlocking.catch(() => {});
    const acquired = await lease.acquire();
    await unlocking;
    if (token !== session || disposed) {
      engine.disable(); lease.release(); return;
    }
    if (!acquired) throw new Error('另一個音訊頁面已啟用。請先在該頁按下停止並停用。');
    active = true;
    router.enable();
    notice(Object.keys(audioConfig.sounds).length
      ? '已啟用。正在預載音源；只會回應啟用後的事件。'
      : '已啟用，但尚未配置音源。保持靜音是正常狀態。');
    void engine.preload();
  } catch (error) {
    if (token === session) deactivate(error.message);
  } finally {
    if (token === session) { enabling = false; paintControls(); }
  }
});
$('stop').addEventListener('click', () => deactivate('已停止所有聲音。再次啟用前不會播放任何事件。'));
$('clear-log').addEventListener('click', () => $('event-log').replaceChildren());
$('test-victory').addEventListener('click', () => {
  if (!active || !router.previewVictory()) return;
  notice('勝利音效測試中：clear 音效＋win 循環配樂。未改動遊戲；按「返回遊戲配樂」恢復。即時遊戲事件仍可能切換聲音。');
});
for (const bus of ['master', 'bgm', 'sfx']) {
  $(bus).value = Math.round(audioConfig.volume[bus] * 100);
  $(`${bus}-value`).textContent = `${$(bus).value}%`;
  $(bus).addEventListener('input', () => {
    engine.setVolume(bus, Number($(bus).value) / 100);
    $(`${bus}-value`).textContent = `${$(bus).value}%`;
  });
}
const soundEntries = Object.entries(audioConfig.sounds);
$('loaded').textContent = `0 / ${soundEntries.length}`;
$('mapping-count').textContent = String(Object.values(audioConfig.events).flat().length);
for (const [id, spec] of soundEntries) {
  const row = document.createElement('div');
  row.style.width = '100%';
  const button = document.createElement('button');
  button.textContent = `試聽 ${id}`;
  button.dataset.sound = id;
  button.title = spec.src;
  button.addEventListener('click', () => {
    if (!active) return;
    // 試聽不送任何遊戲指令。BGM 使用自己的音量通道與 loop 設定。
    engine.stopAll();
    if (spec.kind === 'bgm') void engine.setMusic(id);
    else void engine.playEffect(id);
    notice('試聽中。按「返回遊戲配樂」恢復目前階段；試聽期間仍會接收即時遊戲事件。');
  });
  const text = document.createElement('p');
  const loopLabel = spec.loopEndSeconds
    ? `循環（${spec.loopEndSeconds} 秒直接重播）`
    : (spec.loopCrossfadeMs === 0 ? '循環（整首直接重播，不交叉淡化）'
      : `循環（接點約 ${(spec.loopCrossfadeMs ?? audioConfig.loopCrossfadeMs) / 1000} 秒交叉淡化，短音檔自動縮短）`);
  text.textContent = `${spec.kind === 'bgm' ? (spec.loop ? loopLabel : '播放一次') : '單次音效'}｜${spec.cue}`;
  row.append(button, text);
  $('sound-list').append(row);
}
$('restore-music').addEventListener('click', () => {
  if (!active) return;
  engine.stopAll();
  router.syncMusic();
  notice('已返回目前遊戲階段配樂。');
});
$('empty').hidden = soundEntries.length > 0;

function connect() {
  if (disposed) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  $('connection').textContent = '連線中';
  socket = new WebSocket(`${scheme}//${location.host}/ws`);
  socket.onopen = () => {
    retry = 0;
    $('connection').textContent = '已連線';
    $('connection').dataset.on = 'true';
    log('連線', '只接收遊戲事件，不傳送遊戲指令');
  };
  socket.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message.type !== 'string') return;
    router.handle(message);
    $('phase').textContent = phaseNames[router.scene] || router.scene || '等待快照';
    if (message.type.startsWith('lock-')) return;
    let summary = '';
    if (message.snapshot?.phase) summary = phaseNames[router.scene] || router.scene;
    else if (message.type === 'snapshot') summary = `同步目前階段：${phaseNames[router.scene] || router.scene}`;
    else if (message.type === 'cell-update') summary = `${message.cells?.length ?? 0} 格更新（一批事件）`;
    else summary = message.reason ?? message.mode ?? '';
    log(message.type, summary);
  };
  socket.onclose = () => {
    router.disconnect();
    $('connection').textContent = '離線・等待重連';
    $('connection').dataset.on = 'false';
    $('phase').textContent = '等待連線';
    log('斷線', '已停止播放；重連後僅同步目前階段，不補播舊音效');
    if (!disposed) reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
  };
  socket.onerror = () => socket.close();
}
window.addEventListener('pagehide', () => {
  disposed = true;
  clearTimeout(reconnectTimer);
  deactivate('頁面已關閉');
  socket?.close();
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
paintControls();
if (!['http:', 'https:'].includes(location.protocol)) {
  notice('請先啟動遊戲，再用 http://localhost:3000/audio.html 開啟；不要直接雙擊此檔案。', true);
  $('enable').disabled = true;
} else connect();
