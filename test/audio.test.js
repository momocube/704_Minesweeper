import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioRouter } from '../views/audio/router.js';
import { AudioEngine } from '../views/audio/engine.js';
import { audioConfig } from '../views/audio/config.js';
import { buildCrossfadeLoop, loopPosition } from '../views/audio/loop.js';

function fixture() {
  const calls = [];
  const config = {
    ...audioConfig,
    phaseMusic: { playing: 'loop', gameOver: 'ending', 'timeout-wave': null },
    events: {
      freeze: [{ sound: 'boom' }],
      'cell-update': [{ sound: 'reveal' }],
      'game-over': [{ when: { reason: 'win' }, sound: 'win' }],
      snapshot: [{ sound: 'never' }],
    },
  };
  const engine = {
    setMusic: id => calls.push(['music', id]),
    playEffect: id => calls.push(['effect', id]),
    stopAll: () => calls.push(['stop']),
  };
  return { router: new AudioRouter(config, engine), calls };
}
test('config declares exactly the 15 requested filenames and valid references', () => {
  const names = ['bgm_start.mp3', 'bgm_lose.mp3', 'bgm_game.mp3', 'bgm_win.mp3',
    'sfx_clear.wav', 'sfx_start.wav', 'sfx_countdown.wav', 'sfx_scan.wav',
    'sfx_mark.wav', 'sfx_mine.wav', 'sfx_timeout.wav', 'sfx_pause.wav',
    'sfx_resume.wav', 'sfx_buttom.wav', 'sfx_tutorial.wav'];
  assert.deepEqual(Object.values(audioConfig.sounds).map(s => s.src.split('/').at(-1)), names);
  const references = [...Object.values(audioConfig.phaseMusic),
    ...Object.values(audioConfig.events).flat().flatMap(r => [r.sound, r.after])].filter(Boolean);
  for (const id of references) assert.ok(audioConfig.sounds[id], id);
  for (const id of Object.keys(audioConfig.sounds)) assert.ok(references.includes(id), id);
});
test('all four configured BGM tracks loop; SFX remain one-shot', () => {
  const music = Object.entries(audioConfig.sounds).filter(([, s]) => s.kind === 'bgm');
  assert.equal(music.length, 4);
  for (const [id, spec] of music) assert.equal(spec.loop, true, id);
  for (const [id, spec] of Object.entries(audioConfig.sounds)) {
    if (spec.kind === 'sfx') assert.notEqual(spec.loop, true, id);
  }
});
test('before enable only records current state; never replays past effects', () => {
  const { router, calls } = fixture();
  router.handle({ type: 'snapshot', phase: 'playing' });
  router.handle({ type: 'freeze' });
  assert.deepEqual(calls, []);
  router.enable();
  assert.deepEqual(calls, [['music', 'loop']]);
});
test('snapshot/reconnect restores music without replaying one-shots', () => {
  const { router, calls } = fixture();
  router.enable();
  router.handle({ type: 'snapshot', phase: 'playing' });
  router.disconnect();
  router.handle({ type: 'freeze' });
  router.handle({ type: 'snapshot', phase: 'playing' });
  assert.deepEqual(calls, [['music', 'loop'], ['stop'], ['music', 'loop']]);
});
test('conditional ending cues distinguish win and timeout', () => {
  const { router, calls } = fixture();
  router.enable();
  router.handle({ type: 'game-over', reason: 'timeout', snapshot: { phase: 'gameOver', endStage: 'timeout-wave' } });
  router.handle({ type: 'game-over', reason: 'win', snapshot: { phase: 'gameOver', endStage: 'win-ending' } });
  assert.deepEqual(calls, [['music', null], ['music', 'ending'], ['effect', 'win']]);
});
test('batch of revealed cells triggers only one effect; messages not mutated', () => {
  const { router, calls } = fixture();
  router.handle({ type: 'snapshot', phase: 'playing' });
  router.enable();
  const message = { type: 'cell-update', cells: Array.from({ length: 80 }, (_, id) => ({ id })) };
  const before = JSON.stringify(message);
  router.handle(message);
  assert.equal(JSON.stringify(message), before);
  assert.deepEqual(calls.at(-1), ['effect', 'reveal']);
  assert.equal(calls.filter(c => c[0] === 'effect').length, 1);
});
test('unmapped phase silences music; disabled router ignores triggers', () => {
  const { router, calls } = fixture();
  router.enable();
  router.handle({ type: 'pause', snapshot: { phase: 'paused' } });
  router.disable();
  router.handle({ type: 'freeze' });
  router.handle(null);
  assert.deepEqual(calls, [['music', null], ['stop']]);
});

class Param {
  constructor() { this.value = 0; this.ramps = []; }
  setValueAtTime(value, time) { this.value = value; this.lastSet = { value, time }; }
  setTargetAtTime(value) { this.value = value; }
  cancelAndHoldAtTime() {}
  linearRampToValueAtTime(value, time) { this.value = value; this.lastRamp = { value, time }; this.ramps.push({ value, time }); }
}
class Context {
  constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; this.sources = []; }
  async resume() { this.state = 'running'; }
  createGain() { return { gain: new Param(), connect() {}, disconnect() {} }; }
  createBufferSource() {
    const source = { connect() {}, disconnect() {}, start(when, offset) { this.started = true; this.startWhen = when; this.startOffset = offset; }, stop() { this.stopped = true; } };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() { return { duration: 1 }; }
}
function engineFixture(fetcher) {
  const logs = [];
  let fetchCount = 0;
  const config = { ...audioConfig, loopCrossfadeMs: 0, sounds: {
    a: { src: './audio/assets/a.wav' }, b: { src: './audio/assets/b.wav' },
  } };
  const engine = new AudioEngine(config, (...args) => logs.push(args), {
    AudioContext: Context, baseURL: 'http://localhost:3000/audio.html', now: () => 1000,
    fetch: async url => { fetchCount++; return fetcher ? fetcher(url) : response(); },
  });
  return { engine, config, logs, fetchCount: () => fetchCount };
}
function response() { return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
test('engine does not play before user activation; gains clamp', async () => {
  const { engine } = engineFixture();
  await engine.playEffect('a');
  assert.equal(engine.context, null);
  engine.setVolume('master', 5);
  await engine.unlock();
  assert.equal(engine.buses.master.gain.value, 1);
  engine.setVolume('sfx', -1);
  assert.equal(engine.buses.sfx.gain.value, 0);
});
test('effect cooldown and concurrent limit include pending loads', async () => {
  const pending = deferred();
  const { engine, config, fetchCount } = engineFixture(() => pending.promise);
  config.maxVoices = 1;
  await engine.unlock();
  const first = engine.playEffect('a');
  await engine.playEffect('a');
  await engine.playEffect('b');
  assert.equal(fetchCount(), 1);
  pending.resolve(response());
  await first;
  assert.equal(engine.context.sources.length, 1);
  assert.equal(engine.pendingEffects, 0);
});
test('stop cancels delayed effect even if fetch resolves later', async () => {
  const pending = deferred();
  const { engine } = engineFixture(() => pending.promise);
  await engine.unlock();
  const first = engine.playEffect('a');
  engine.stopAll();
  pending.resolve(response());
  await first;
  assert.equal(engine.context.sources.length, 0);
});
test('only latest music request plays when async loads race', async () => {
  const pending = deferred();
  const { engine } = engineFixture(url => url.includes('a.wav') ? pending.promise : response());
  await engine.unlock();
  const first = engine.setMusic('a');
  await engine.setMusic('b');
  pending.resolve(response());
  await first;
  assert.equal(engine.musicId, 'b');
  assert.equal(engine.context.sources.length, 1);
  assert.equal(engine.context.sources[0].loop, true);
  await engine.setMusic('b');
  assert.equal(engine.context.sources.length, 1);
  await engine.setMusic(null);
  assert.equal(engine.context.sources[0].stopped, true);
});
test('missing assets report a recoverable error without rejected playback', async () => {
  const { engine, logs } = engineFixture(() => ({ ok: false, status: 404 }));
  await engine.unlock();
  await engine.setMusic('a');
  await engine.playEffect('b');
  assert.equal(engine.musicId, null);
  assert.equal(engine.cache.size, 0);
  assert.equal(logs.filter(x => x[0] === 'error').length, 2);
});
test('buffers are cached and preload shares in-flight loads', async () => {
  const { engine, fetchCount } = engineFixture();
  await engine.unlock();
  await Promise.all([engine.preload(), engine.setMusic('a')]);
  assert.equal(fetchCount(), 2);
  engine.disable();
  assert.equal(engine.ready, false);
  assert.equal(engine.voices.size, 0);
});
test('remote asset URLs are rejected before fetch', async () => {
  const { engine, config, fetchCount } = engineFixture();
  config.sounds.a.src = 'https://example.com/a.wav';
  await engine.unlock();
  await assert.rejects(engine.load('a'), /同來源/);
  assert.equal(fetchCount(), 0);
});

function configuredFixture() {
  const calls = [];
  const completions = new Map();
  const engine = {
    setMusic: id => calls.push(['music', id]),
    playEffect: (id, done) => { calls.push(['effect', id]); completions.set(id, done); },
    stopEffects: id => calls.push(['stop-effects', id]),
    stopAll: () => calls.push(['stop']),
  };
  const previews = [];
  const router = new AudioRouter(audioConfig, engine, (...args) => previews.push(args));
  router.handle({ type: 'snapshot', phase: 'playing' });
  router.enable();
  calls.length = 0;
  return { router, calls, previews, completions, effects: () => calls.filter(c => c[0] === 'effect').map(c => c[1]) };
}
test('SCAN reveal and MARK flag/unflag including zero are distinct', () => {
  const { router, effects } = configuredFixture();
  router.handle({ type: 'cell-update', cells: [{ flagged: true }], flaggedCount: 1 });
  router.handle({ type: 'cell-update', cells: [{ flagged: false }], flaggedCount: 0 });
  router.handle({ type: 'cell-update', cells: Array(80).fill({ revealed: true }), revealedCount: 80 });
  router.handle({ type: 'cell-update', cells: [] });
  assert.deepEqual(effects(), ['sfx_mark', 'sfx_mark', 'sfx_scan']);
});
test('complete countdown track plays only at 3 and is cancelled at game-start', () => {
  const { router, effects, calls } = configuredFixture();
  for (const [type, countdownValue] of [['countdown-start', 3], ['countdown-tick', 2], ['countdown-tick', 1]]) {
    router.handle({ type, snapshot: { phase: 'countdown', countdownValue } });
  }
  assert.deepEqual(effects(), ['sfx_buttom', 'sfx_countdown']);
  router.handle({ type: 'game-start', snapshot: { phase: 'playing' } });
  assert.ok(calls.some(c => c[0] === 'stop-effects' && c[1] === 'sfx_countdown'));
  assert.ok(calls.some(c => c[0] === 'music' && c[1] === 'bgm_game'));
});
test('mine is not defeat; win, timeout, and operator have distinct cues', () => {
  for (const [reason, stage, music, effect] of [
    ['win', 'win-ending', 'bgm_win', 'sfx_clear'],
    ['timeout', 'timeout-wave', 'bgm_lose', 'sfx_timeout'],
    ['operator', 'operator-ending', 'bgm_lose', 'sfx_timeout'],
  ]) {
    const { router, calls, effects } = configuredFixture();
    router.handle({ type: 'game-over', reason, snapshot: { phase: 'gameOver', endStage: stage } });
    assert.deepEqual(effects(), effect ? [effect] : []);
    assert.ok(calls.some(c => c[0] === 'music' && c[1] === music));
    assert.ok(calls.findIndex(c => c[0] === 'stop-effects') < calls.findIndex(c => c[0] === 'effect') || !effect);
  }
  const { router, calls, effects } = configuredFixture();
  router.handle({ type: 'freeze' });
  router.handle({ type: 'unfreeze' });
  assert.deepEqual(effects(), ['sfx_mine']);
  assert.equal(calls.filter(c => c[0] === 'music').length, 0);
});
test('pause/resume and intro use dedicated cues, without generic click', () => {
  const { router, calls, effects } = configuredFixture();
  router.handle({ type: 'intro-start', snapshot: { phase: 'intro' } });
  router.handle({ type: 'pause', snapshot: { phase: 'paused' } });
  router.handle({ type: 'resume', snapshot: { phase: 'playing' } });
  assert.deepEqual(effects(), ['sfx_start', 'sfx_pause', 'sfx_resume']);
  assert.deepEqual(calls.filter(c => c[0] === 'music').map(c => c[1]), [null, null, 'bgm_game']);
});
test('generic button covers accepted flow actions only, not transition completion', () => {
  const { router, effects } = configuredFixture();
  for (const type of ['armed', 'tutorial-start', 'tutorial-step', 'tutorial-ready',
    'mode-change', 'ending-start', 'reset']) router.handle({ type });
  for (const type of ['intro-complete', 'operator-transition-complete',
    'idle-echo', 'lock-update']) router.handle({ type });
  assert.deepEqual(effects(), Array(7).fill('sfx_buttom'));
});
test('tutorial PLAY keeps button sound and chains tutorial after its natural end', () => {
  const { router, effects, completions } = configuredFixture();
  router.handle({ type: 'tutorial-start', snapshot: { phase: 'tutorial', tutorialStep: 0 } });
  assert.deepEqual(effects(), ['sfx_buttom']);
  completions.get('sfx_buttom')();
  assert.deepEqual(effects(), ['sfx_buttom', 'sfx_tutorial']);
  router.handle({ type: 'tutorial-transition-complete', snapshot: { phase: 'tutorial', tutorialStep: 0 } });
  assert.deepEqual(effects(), ['sfx_buttom', 'sfx_tutorial']);
  for (const tutorialStep of [1, 2, 3]) {
    router.handle({ type: 'tutorial-step', snapshot: { phase: 'tutorial', tutorialStep } });
  }
  router.handle({ type: 'tutorial-ready', snapshot: { phase: 'tutorialReady' } });
  router.disconnect();
  router.handle({ type: 'snapshot', phase: 'tutorial', tutorialStep: 0 });
  router.disable();
  router.enable();
  assert.equal(effects().filter(id => id === 'sfx_tutorial').length, 1);
});
test('disabled page previews intended cues without playing them', () => {
  const { router, effects, previews } = configuredFixture();
  router.disable();
  router.handle({ type: 'freeze' });
  assert.deepEqual(effects(), []);
  assert.deepEqual(previews, [['freeze', 'sfx_mine', false]]);
});
test('non-looping outcome music does not restart on same-scene updates', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a.loop = false;
  await engine.unlock();
  await engine.setMusic('a');
  assert.equal(engine.context.sources[0].loop, false);
  engine.context.sources[0].onended();
  await engine.setMusic('a');
  assert.equal(engine.context.sources.length, 1);
  engine.stopAll();
  await engine.setMusic('a');
  assert.equal(engine.context.sources.length, 2);
});
test('targeted cancellation also cancels in-flight countdown loading', async () => {
  const pending = deferred();
  const { engine } = engineFixture(() => pending.promise);
  await engine.unlock();
  const effect = engine.playEffect('a');
  engine.stopEffects('a');
  pending.resolve(response());
  await effect;
  assert.equal(engine.context.sources.length, 0);
});
test('stopping effects does not stop current BGM', async () => {
  const { engine } = engineFixture();
  await engine.unlock();
  await engine.setMusic('a');
  await engine.playEffect('b');
  engine.stopEffects();
  assert.equal(engine.musicVoice.stopped, false);
  assert.equal([...engine.voices].find(v => v.bus === 'sfx').stopped, true);
});

test('start music remains silent until actual opening effect completion across intro/ready', () => {
  const { router, calls, completions } = configuredFixture();
  for (const phase of ['idle', 'armed']) router.handle({ type: 'snapshot', phase });
  router.handle({ type: 'intro-start', snapshot: { phase: 'intro' } });
  router.handle({ type: 'intro-complete', snapshot: { phase: 'ready' } });
  assert.ok(!calls.some(c => c[0] === 'music' && c[1] === 'bgm_start'));
  completions.get('sfx_start')();
  assert.deepEqual(calls.at(-1), ['music', 'bgm_start']);
  router.handle({ type: 'tutorial-start', snapshot: { phase: 'tutorial', tutorialStep: 0 } });
  assert.equal(router.musicGateOpen, true);
  router.handle({ type: 'countdown-start', snapshot: { phase: 'countdown' } });
  assert.equal(router.musicGateOpen, false);
});
test('late opening completion cannot start music after stop, disconnect, reset or game start', () => {
  for (const action of ['disable', 'disconnect', 'reset', 'game-start', 'game-over', 'armed']) {
    const { router, calls, completions } = configuredFixture();
    router.handle({ type: 'intro-start', snapshot: { phase: 'intro' } });
    if (['disable', 'disconnect'].includes(action)) router[action]();
    else router.handle({ type: action, snapshot: { phase: action === 'game-start' ? 'playing' : action === 'game-over' ? 'gameOver' : 'idle' } });
    const n = calls.length;
    completions.get('sfx_start')();
    assert.equal(calls.length, n, action);
  }
});
test('joining ready does not infer opening sound completion or replay opening sound', () => {
  const { router, calls, effects } = configuredFixture();
  router.disconnect();
  router.handle({ type: 'snapshot', phase: 'ready' });
  assert.deepEqual(calls.filter(c => c[0] === 'music').at(-1), ['music', null]);
  assert.deepEqual(effects(), []);
});
test('tutorial chain cancels when stopped, reset, or first step already left', () => {
  for (const action of ['disable', 'disconnect', 'reset', 'step']) {
    const { router, effects, completions } = configuredFixture();
    router.handle({ type: 'tutorial-start', snapshot: { phase: 'tutorial', tutorialStep: 0 } });
    const finish = completions.get('sfx_buttom');
    if (['disable', 'disconnect'].includes(action)) router[action]();
    else router.handle({ type: action === 'step' ? 'tutorial-step' : 'reset', snapshot: { phase: action === 'step' ? 'tutorial' : 'idle', tutorialStep: 1 } });
    finish();
    assert.ok(!effects().includes('sfx_tutorial'), action);
  }
});
test('engine completion callback runs only on natural end, never stop or failure', async () => {
  for (const action of ['natural', 'stopEffects', 'stopAll', 'disable']) {
    const { engine } = engineFixture();
    let completed = 0;
    await engine.unlock();
    await engine.playEffect('a', () => completed++);
    const source = engine.context.sources[0];
    assert.equal(completed, 0);
    if (action !== 'natural') engine[action]();
    source.onended();
    assert.equal(completed, action === 'natural' ? 1 : 0, action);
  }
  const { engine } = engineFixture(() => ({ ok: false, status: 404 }));
  await engine.unlock();
  let completed = 0;
  await engine.playEffect('a', () => completed++);
  assert.equal(completed, 0);
});

test('tutorial duck ramps separately from BGM slider and restores on natural end', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a.duckBgm = audioConfig.sounds.sfx_tutorial.duckBgm;
  await engine.unlock();
  await engine.playEffect('a');
  const param = engine.bgmDuck.gain;
  const schedule = [...engine.voices][0].duckSchedule;
  assert.equal(schedule.releaseStart, 1.5); // 音檔 clock 2 結束，提前 0.5 秒
  assert.equal(schedule.releaseEnd, 2.7);
  assert.ok(Math.abs(param.ramps[31].value - 0.3) < 1e-9);
  assert.equal(param.ramps[31].time, 1.4);
  assert.equal(param.ramps.length, 64);
  engine.setVolume('bgm', 0.5);
  assert.equal(engine.buses.bgm.gain.value, 0.5);
  assert.equal(engine.volumes.bgm, 0.5);
  engine.context.currentTime = 2;
  engine.context.sources[0].onended();
  assert.deepEqual(param.lastRamp, { value: 1, time: 2.7 });
  assert.equal(param.ramps.length, 64); // 自然結束不重新排一次回升
  assert.equal(engine.buses.bgm.gain.value, 0.5);
});
test('duck recovers on targeted stop, stop-all and disable without waiting for onended', async () => {
  for (const method of ['stopEffects', 'stopAll', 'disable']) {
    const { engine, config } = engineFixture();
    config.sounds.a.duckBgm = { level: 0.3, attackMs: 400, releaseMs: 800 };
    await engine.unlock();
    await engine.playEffect('a');
    engine[method]('a');
    assert.equal(engine.bgmDuck.gain.value, 1, method);
    assert.equal(engine.duckVoices.size, 0, method);
    engine.context.sources[0].onended();
    assert.equal(engine.bgmDuck.gain.value, 1);
  }
});
test('pending, missing and cancelled loads never duck BGM', async () => {
  const pending = deferred();
  const { engine, config } = engineFixture(() => pending.promise);
  config.sounds.a.duckBgm = audioConfig.sounds.sfx_tutorial.duckBgm;
  await engine.unlock();
  const playing = engine.playEffect('a');
  assert.equal(engine.bgmDuck.gain.value, 1);
  engine.stopEffects('a');
  pending.resolve(response());
  await playing;
  assert.equal(engine.bgmDuck.gain.value, 1);
  const missing = engineFixture(() => ({ ok: false, status: 404 }));
  missing.config.sounds.a.duckBgm = config.sounds.a.duckBgm;
  await missing.engine.unlock();
  await missing.engine.playEffect('a');
  assert.equal(missing.engine.bgmDuck.gain.value, 1);
});
test('overlapping duck voices keep attenuation until last one ends; ordinary SFX do not duck', async () => {
  const { engine, config } = engineFixture();
  await engine.unlock();
  await engine.playEffect('b');
  assert.equal(engine.bgmDuck.gain.value, 1);
  engine.stopAll();
  config.sounds.a.duckBgm = { level: 0.3 };
  config.sounds.b.duckBgm = { level: 0.2 };
  await engine.playEffect('a');
  await engine.playEffect('b');
  assert.equal(engine.bgmDuck.gain.value, 0.2);
  engine.context.sources[2].onended();
  assert.equal(engine.bgmDuck.gain.value, 0.3);
  engine.context.sources[1].onended();
  assert.equal(engine.bgmDuck.gain.value, 1);
});

test('lose BGM fades from zero over 3.5s without changing user volume; same track does not restart', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a = { ...audioConfig.sounds.bgm_lose };
  await engine.unlock();
  engine.setVolume('bgm', 0.45);
  await engine.setMusic('a');
  const voice = engine.musicVoice;
  assert.equal(config.sounds.a.fadeInMs, 3500);
  assert.deepEqual(voice.gain.gain.lastSet, { value: 0, time: 1 });
  assert.deepEqual(voice.gain.gain.lastRamp, { value: 1, time: 4.5 });
  assert.equal(voice.source.loop, true);
  assert.equal(engine.buses.bgm.gain.value, 0.45);
  engine.context.currentTime = 2;
  await engine.setMusic('a');
  assert.equal(engine.musicVoice, voice);
  assert.deepEqual(voice.gain.gain.lastRamp, { value: 1, time: 4.5 });
  await engine.setMusic('b');
  assert.deepEqual(engine.musicVoice.gain.gain.lastRamp, { value: 1, time: 2.8 });
});

test('pause saves loop position; resume excludes paused time and repeated cycles accumulate', async () => {
  const { engine } = engineFixture();
  await engine.unlock();
  await engine.setMusic('a'); // 1 second test buffer, starts at clock 1
  engine.context.currentTime = 3.25;
  engine.pauseMusic('a');
  assert.equal(engine.pausedMusic.offset, 0.25);
  assert.equal(engine.musicId, null);
  engine.context.currentTime = 50;
  engine.pauseMusic('a'); // duplicate paused snapshot must not overwrite position
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0.25);
  engine.context.currentTime = 50.5;
  engine.pauseMusic('a');
  assert.equal(engine.pausedMusic.offset, 0.75);
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0.75);
});
test('pause during loading cancels old start and resumes at zero once loaded', async () => {
  const pending = deferred();
  const { engine } = engineFixture(() => pending.promise);
  await engine.unlock();
  const starting = engine.setMusic('a');
  engine.pauseMusic('a');
  pending.resolve(response());
  await starting;
  assert.equal(engine.context.sources.length, 0);
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0);
});
test('quick re-pause while resume awaits cached buffer retains saved offset', async () => {
  const { engine } = engineFixture();
  await engine.unlock();
  await engine.setMusic('a');
  engine.context.currentTime = 1.5;
  engine.pauseMusic('a');
  const resuming = engine.setMusic('a', { resume: true });
  engine.pauseMusic('a');
  await resuming;
  assert.equal(engine.pausedMusic.offset, 0.5);
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0.5);
});
test('new round and stop-all clear paused position', async () => {
  const { engine } = engineFixture();
  await engine.unlock();
  await engine.setMusic('a');
  engine.context.currentTime = 1.5;
  engine.pauseMusic('a');
  engine.clearPausedMusic();
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0);
  engine.context.currentTime = 1.75;
  engine.pauseMusic('a');
  engine.stopAll();
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 0);
});
test('router requests pause/resume and clears saved position on new round and endings', () => {
  const calls = [];
  const engine = {
    setMusic: (id, opts) => calls.push(['music', id, opts]),
    pauseMusic: id => calls.push(['pause', id]),
    clearPausedMusic: () => calls.push(['clear']),
    playEffect() {}, stopAll() {},
  };
  const router = new AudioRouter(audioConfig, engine);
  router.enable();
  router.handle({ type: 'pause', snapshot: { phase: 'paused' } });
  assert.deepEqual(calls[0], ['pause', 'bgm_game']);
  router.handle({ type: 'resume', snapshot: { phase: 'playing' } });
  assert.deepEqual(calls.at(-1), ['music', 'bgm_game', { resume: true }]);
  for (const type of ['game-start', 'game-over', 'reset', 'armed']) {
    calls.length = 0;
    router.handle({ type, snapshot: { phase: type === 'game-start' ? 'playing' : 'idle' } });
    assert.deepEqual(calls[0], ['clear']);
  }
});

test('victory preview plays configured win cues without altering actual state or gate', () => {
  const { router, calls, effects, previews } = configuredFixture();
  const state = router.state;
  router.musicGateOpen = true;
  assert.equal(router.previewVictory(), true);
  assert.equal(router.state, state);
  assert.equal(router.state.phase, 'playing');
  assert.equal(router.musicGateOpen, true);
  assert.ok(calls.some(c => c[0] === 'music' && c[1] === 'bgm_win'));
  assert.deepEqual(effects(), ['sfx_clear']);
  assert.ok(previews.some(p => p[0].includes('本機勝利測試')));
  router.syncMusic();
  assert.deepEqual(calls.at(-1), ['music', 'bgm_game']);
});
test('victory preview requires activation and works without a server snapshot', () => {
  const { router, calls } = configuredFixture();
  router.disable();
  const count = calls.length;
  assert.equal(router.previewVictory(), false);
  assert.equal(calls.length, count);
  router.disconnect();
  router.enable();
  assert.equal(router.previewVictory(), true);
  assert.equal(router.state, null);
});

test('opening SFX schedules 1s later and only completes when audio ends', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a = { ...audioConfig.sounds.sfx_start };
  assert.equal(config.sounds.a.delayMs, 1000);
  await engine.unlock();
  let completed = 0;
  await engine.playEffect('a', () => completed++);
  assert.equal(engine.context.sources[0].startWhen, 2);
  assert.equal(completed, 0);
  engine.context.sources[0].onended();
  assert.equal(completed, 1);
  await engine.playEffect('b');
  assert.equal(engine.context.sources[1].startWhen, 1);
});
test('stopping scheduled opening effect cancels completion and BGM handoff', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a.delayMs = 500;
  await engine.unlock();
  let completed = 0;
  await engine.playEffect('a', () => completed++);
  engine.stopEffects('a');
  assert.equal(engine.context.sources[0].stopped, true);
  engine.context.sources[0].onended();
  assert.equal(completed, 0);
});
test('asset loading time is included in SFX delay, not added to it', async () => {
  for (const loadedAt of [1.2, 1.8]) {
    const pending = deferred();
    const { engine, config } = engineFixture(() => pending.promise);
    config.sounds.a.delayMs = 500;
    await engine.unlock();
    const playing = engine.playEffect('a');
    engine.context.currentTime = loadedAt;
    pending.resolve(response());
    await playing;
    assert.equal(engine.context.sources[0].startWhen, Math.max(1.5, loadedAt));
  }
});

test('short tutorial starts recovery immediately after attenuation, without inverted timing', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a.duckBgm = audioConfig.sounds.sfx_tutorial.duckBgm;
  await engine.unlock();
  engine.context.decodeAudioData = async () => ({ duration: 0.2 });
  await engine.playEffect('a');
  const schedule = [...engine.voices][0].duckSchedule;
  assert.equal(schedule.releaseStart, 1.2);
  assert.equal(schedule.releaseEnd, 2.4);
  const ramps = engine.bgmDuck.gain.ramps;
  assert.ok(ramps.every((r, i) => i === 0 || r.time >= ramps[i - 1].time));
});
test('interrupting smooth duck cancels future recovery and schedules smooth release now', async () => {
  const { engine, config } = engineFixture();
  config.sounds.a.duckBgm = audioConfig.sounds.sfx_tutorial.duckBgm;
  await engine.unlock();
  await engine.playEffect('a');
  engine.context.currentTime = 1.25;
  engine.stopEffects('a');
  assert.deepEqual(engine.bgmDuck.gain.lastRamp, { value: 1, time: 2.45 });
  const count = engine.bgmDuck.gain.ramps.length;
  engine.context.sources[0].onended();
  assert.equal(engine.bgmDuck.gain.ramps.length, count);
});

function sampleBuffer(channels = 2, length = 1000, sampleRate = 100) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: channel => data[channel] };
}
test('BGM loop mixes final 3s with opening using complementary smooth weights', () => {
  assert.equal(audioConfig.loopCrossfadeMs, 3000);
  const original = sampleBuffer(2, 1600);
  original.getChannelData(0).fill(0.6, 0, 300);
  original.getChannelData(0).fill(-0.4, 1300);
  original.getChannelData(1).fill(0.25);
  const before = original.getChannelData(0).slice();
  const result = buildCrossfadeLoop({ createBuffer: sampleBuffer }, original, audioConfig.loopCrossfadeMs);
  assert.equal(result.loopStart, 3);
  assert.equal(result.buffer.duration, 16);
  assert.notEqual(result.buffer, original);
  assert.deepEqual(original.getChannelData(0), before);
  const output = result.buffer.getChannelData(0);
  assert.equal(output[1300], before[1300]);
  assert.equal(output[1599], before[299]);
  assert.ok(output[1449] > -0.4 && output[1449] < 0.6);
  assert.ok(result.buffer.getChannelData(1).every(x => x === 0.25));
});
test('crossfade keeps original body and resumes after consumed opening without replay', () => {
  const original = sampleBuffer(1);
  for (let i = 0; i < original.length; i++) original.getChannelData(0)[i] = Math.sin(i / 10);
  const { buffer, loopStart } = buildCrossfadeLoop({ createBuffer: sampleBuffer }, original, 2000);
  assert.deepEqual(buffer.getChannelData(0).slice(0, 800), original.getChannelData(0).slice(0, 800));
  assert.equal(loopStart, 2);
  assert.equal(loopPosition(9, 10, 2), 9);
  assert.equal(loopPosition(10, 10, 2), 2);
  assert.equal(loopPosition(19, 10, 2), 3);
});
test('short files limit overlap to quarter length and tiny files safely bypass mixing', () => {
  const ctx = { createBuffer: sampleBuffer };
  assert.equal(buildCrossfadeLoop(ctx, sampleBuffer(1, 100, 100), 2000).loopStart, 0.25);
  const tiny = sampleBuffer(1, 4, 100);
  assert.equal(buildCrossfadeLoop(ctx, tiny, 2000).buffer, tiny);
  const normal = sampleBuffer();
  assert.equal(buildCrossfadeLoop(ctx, normal, 0).buffer, normal);
});
test('engine loops processed audio natively, caches preparation, and resumes crossfade position', async () => {
  const { engine, config } = engineFixture();
  config.loopCrossfadeMs = 2000;
  await engine.unlock();
  engine.context.createBuffer = sampleBuffer;
  const original = sampleBuffer();
  engine.context.decodeAudioData = async () => original;
  await engine.setMusic('a');
  const voice = engine.musicVoice;
  assert.equal(voice.source.loop, true);
  assert.equal(voice.source.loopStart, 2);
  assert.equal(voice.source.loopEnd, 10);
  assert.equal(voice.source.startOffset, 0);
  assert.notEqual(voice.source.buffer, original);
  engine.context.currentTime = 20; // 19s played: 10 + 8 + 1 -> offset 3
  engine.pauseMusic('a');
  assert.equal(engine.pausedMusic.offset, 3);
  engine.context.currentTime = 50;
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 3);
  assert.equal(engine.musicVoice.source.buffer, voice.source.buffer);
  assert.equal(engine.context.sources.length, 2); // no timer-driven source proliferation
  engine.stopAll();
  assert.equal(engine.voices.size, 0);
});
test('non-loop music and SFX bypass crossfade processing', async () => {
  const { engine, config } = engineFixture();
  config.loopCrossfadeMs = 2000;
  config.sounds.a.loop = false;
  await engine.unlock();
  const original = sampleBuffer();
  engine.context.decodeAudioData = async () => original;
  engine.context.createBuffer = () => { throw new Error('must not process'); };
  await engine.setMusic('a');
  assert.equal(engine.musicVoice.source.buffer, original);
  assert.equal(engine.musicVoice.source.loopStart, 0);
  await engine.playEffect('b');
  assert.equal(engine.context.sources[1].buffer, original);
});

test('game BGM loops full original file without custom endpoint or crossfade and resumes correctly', async () => {
  const { engine, config } = engineFixture();
  config.loopCrossfadeMs = audioConfig.loopCrossfadeMs;
  config.sounds.a = { ...audioConfig.sounds.bgm_game };
  await engine.unlock();
  const original = sampleBuffer(1, 13000, 100);
  engine.context.decodeAudioData = async () => original;
  engine.context.createBuffer = () => { throw new Error('game BGM must not crossfade'); };
  await engine.setMusic('a');
  assert.equal(engine.musicVoice.source.buffer, original);
  assert.equal(engine.musicVoice.source.loopStart, 0);
  assert.equal(engine.musicVoice.source.loopEnd, 130);
  assert.equal(engine.musicVoice.source.loop, true);
  assert.equal(audioConfig.sounds.bgm_game.loopCrossfadeMs, 0);
  assert.equal(Object.hasOwn(audioConfig.sounds.bgm_game, 'loopEndSeconds'), false);
  engine.context.currentTime = 121; // 120s played: must not wrap at the old 116.39s point
  engine.pauseMusic('a');
  assert.equal(engine.pausedMusic.offset, 120);
  engine.context.currentTime = 200;
  await engine.setMusic('a', { resume: true });
  assert.equal(engine.musicVoice.source.startOffset, 120);
  assert.equal(engine.musicVoice.source.loopEnd, 130);
  engine.context.currentTime = 215;
  engine.pauseMusic('a');
  assert.equal(engine.pausedMusic.offset, 5);
});
test('game BGM follows replacement file length; other BGM retains global 3s crossfade', async () => {
  const { engine, config } = engineFixture();
  config.loopCrossfadeMs = audioConfig.loopCrossfadeMs;
  config.sounds.a = { ...audioConfig.sounds.bgm_game };
  config.sounds.b = { ...audioConfig.sounds.bgm_win };
  await engine.unlock();
  const original = sampleBuffer(1, 1600, 100);
  engine.context.decodeAudioData = async () => original;
  engine.context.createBuffer = sampleBuffer;
  await engine.setMusic('a');
  assert.equal(engine.musicVoice.source.loopEnd, 16);
  assert.equal(engine.musicVoice.source.buffer, original);
  await engine.setMusic('b');
  assert.equal(engine.musicVoice.source.loopStart, 3);
  assert.equal(engine.musicVoice.source.loopEnd, 16);
  assert.notEqual(engine.musicVoice.source.buffer, original);
});
