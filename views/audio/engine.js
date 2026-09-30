import { buildCrossfadeLoop, loopPosition } from './loop.js';

const clamp = value => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(1, Number(value))) : 0;

/** 獨立 Web Audio 引擎。fetch + decodeAudioData 不依賴伺服器的音檔 MIME 表。 */
export class AudioEngine {
  constructor(config, report = () => {}, dependencies = {}) {
    this.config = config;
    this.report = report;
    this.deps = dependencies;
    this.context = null;
    this.buses = {};
    this.bgmDuck = null;
    this.duckVoices = new Map();
    this.volumes = { ...config.volume };
    this.cache = new Map();
    this.loopCache = new WeakMap();
    this.voices = new Set();
    this.cooldowns = new Map();
    this.pendingEffects = 0;
    this.musicId = null;
    this.musicVoice = null;
    this.pausedMusic = null;
    this.musicGeneration = 0;
    this.epoch = 0;
    this.effectsEpoch = 0;
    this.effectVersions = new Map();
    this.ready = false;
  }

  async unlock() {
    if (!this.context) {
      const Context = this.deps.AudioContext ?? globalThis.AudioContext;
      if (!Context) throw new Error('此瀏覽器不支援 Web Audio。請使用 Chrome 或 Edge。');
      this.context = new Context();
      for (const bus of ['master', 'bgm', 'sfx']) {
        this.buses[bus] = this.context.createGain();
        this.buses[bus].gain.value = clamp(this.volumes[bus]);
      }
      this.buses.master.connect(this.context.destination);
      // 獨立乘數，不改使用者 BGM 滑桿值，也不影響 SFX 通道。
      this.bgmDuck = this.context.createGain();
      this.bgmDuck.gain.value = 1;
      this.buses.bgm.connect(this.bgmDuck);
      this.bgmDuck.connect(this.buses.master);
      this.buses.sfx.connect(this.buses.master);
      this.context.onstatechange = () => {
        this.report('context', this.context.state);
      };
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('音訊未啟用，請再次點擊啟用聲音。');
    this.ready = true;
  }

  setVolume(bus, value) {
    if (!Object.hasOwn(this.volumes, bus)) return;
    this.volumes[bus] = clamp(value);
    if (this.buses[bus]) {
      this.buses[bus].gain.setTargetAtTime(this.volumes[bus], this.context.currentTime, 0.02);
    }
  }

  async load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const spec = this.config.sounds[id];
    if (!spec?.src) throw new Error(`尚未設定音源：${id}`);
    const url = new URL(spec.src, this.deps.baseURL ?? globalThis.location.href);
    const base = new URL(this.deps.baseURL ?? globalThis.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin) {
      throw new Error(`音源必須使用本機同來源路徑：${id}`);
    }
    const promise = (async () => {
      const fetcher = this.deps.fetch ?? globalThis.fetch;
      const response = await fetcher(url.href, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`音源 ${id} 讀取失敗（HTTP ${response.status}）`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > this.config.maxFileBytes) throw new Error(`音源 ${id} 檔案過大`);
      const buffer = await this.context.decodeAudioData(bytes);
      if (buffer.duration > this.config.maxDurationSeconds) throw new Error(`音源 ${id} 長度超過限制`);
      this.report('loaded', id);
      return buffer;
    })();
    this.cache.set(id, promise);
    try { return await promise; }
    catch (error) { this.cache.delete(id); throw error; }
  }

  async preload() {
    // 依序解碼，避免多個大音檔同時佔滿記憶體。缺檔不阻斷其他音源。
    for (const id of Object.keys(this.config.sounds)) {
      if (!this.ready) break;
      try { await this.load(id); }
      catch (error) { this.report('error', error.message); }
    }
  }

  updateDuck(durationMs) {
    if (!this.bgmDuck) return;
    const level = Math.min(1, ...[...this.duckVoices.values()].map(d => clamp(d.level)));
    const now = this.context.currentTime;
    this.bgmDuck.gain.cancelAndHoldAtTime(now);
    this.bgmDuck.gain.linearRampToValueAtTime(level, now + Math.max(0, durationMs) / 1000);
  }

  // 以 AudioContext 時間排程 S 曲線，不依賴背景分頁可能被節流的 setTimeout。
  scheduleTutorialDuck(voice, duck, buffer) {
    const param = this.bgmDuck.gain;
    const now = this.context.currentTime;
    const start = Math.max(now, voice.startedAt);
    const attack = Math.min(Math.max(0, duck.attackMs ?? 400) / 1000,
      Math.max(0, buffer.duration - voice.offset));
    const releaseStart = Math.max(start + attack,
      start + buffer.duration - voice.offset - Math.max(0, duck.releaseBeforeEndMs) / 1000);
    const releaseEnd = releaseStart + Math.max(0, duck.releaseMs ?? 1200) / 1000;
    voice.duckSchedule = { releaseStart, releaseEnd };
    param.cancelAndHoldAtTime(now);
    const from = param.value;
    this.smoothDuckRamp(from, clamp(duck.level), start, start + attack);
    param.setValueAtTime(clamp(duck.level), releaseStart);
    this.smoothDuckRamp(clamp(duck.level), 1, releaseStart, releaseEnd);
  }

  smoothDuckRamp(from, to, start, end) {
    const param = this.bgmDuck.gain;
    param.setValueAtTime(from, start);
    // 32 段近似 smoothstep，起終點斜率為零，不會突然開始或收尾。
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const ease = t * t * (3 - 2 * t);
      param.linearRampToValueAtTime(from + (to - from) * ease, start + (end - start) * t);
    }
  }

  releaseDuck(voice) {
    const duck = this.duckVoices.get(voice);
    if (!duck) return;
    this.duckVoices.delete(voice);
    // 自然結束時回升已經開始，保留既有排程，不從尾音重新淡入一次。
    if (voice.duckSchedule && !voice.stopped && this.duckVoices.size === 0) return;
    if (duck.smooth && this.duckVoices.size === 0) {
      const now = this.context.currentTime;
      const param = this.bgmDuck.gain;
      param.cancelAndHoldAtTime(now);
      this.smoothDuckRamp(param.value, 1, now, now + Math.max(0, duck.releaseMs ?? 1200) / 1000);
    } else this.updateDuck(duck.releaseMs ?? 800);
  }

  prepareMusicLoop(id, buffer) {
    if (this.config.sounds[id].loop === false) return { buffer, loopStart: 0 };
    const end = this.config.sounds[id].loopEndSeconds;
    if (Number.isFinite(end) && end > 0) {
      // 指定直接重播點時保留原 buffer，不混合、不修改原音檔。
      return { buffer, loopStart: 0, loopEnd: Math.min(end, buffer.duration) };
    }
    const fadeMs = this.config.sounds[id].loopCrossfadeMs ?? this.config.loopCrossfadeMs ?? 0;
    let variants = this.loopCache.get(buffer);
    if (!variants) { variants = new Map(); this.loopCache.set(buffer, variants); }
    if (!variants.has(fadeMs)) variants.set(fadeMs, buildCrossfadeLoop(this.context, buffer, fadeMs));
    return variants.get(fadeMs);
  }

  makeVoice(buffer, id, bus, loop, initialGain, onComplete = null, offset = 0, startAt = this.context.currentTime, loopStart = 0, loopEnd = buffer.duration) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    source.loopStart = loopStart;
    source.loopEnd = loopEnd;
    gain.gain.value = initialGain;
    source.connect(gain);
    gain.connect(this.buses[bus]);
    const voice = { source, gain, bus, id, stopped: false,
      startedAt: Math.max(this.context.currentTime, startAt), offset };
    source.onended = () => {
      this.voices.delete(voice);
      this.releaseDuck(voice);
      source.disconnect();
      gain.disconnect();
      if (!voice.stopped) onComplete?.();
    };
    this.voices.add(voice);
    try { source.start(voice.startedAt, offset); }
    catch (error) {
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
      throw error;
    }
    const duck = bus === 'sfx' ? this.config.sounds[id]?.duckBgm : null;
    if (duck) {
      this.duckVoices.set(voice, duck);
      if (duck.smooth && duck.releaseBeforeEndMs != null && this.duckVoices.size === 1) {
        this.scheduleTutorialDuck(voice, duck, buffer);
      } else {
        // 多個壓低音量音效重疊時維持較低音量，不讓舊排程提前拉高。
        for (const active of this.duckVoices.keys()) active.duckSchedule = null;
        this.updateDuck(duck.attackMs ?? 400);
      }
    }
    return voice;
  }

  stopVoice(voice, fadeMs = 0) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    const now = this.context.currentTime;
    const duration = Math.max(0, fadeMs) / 1000;
    const param = voice.gain.gain;
    param.cancelAndHoldAtTime(now);
    param.linearRampToValueAtTime(0, now + duration);
    voice.source.stop(now + duration);
    if (duration === 0) this.releaseDuck(voice);
  }

  async playEffect(id, onComplete = null) {
    if (!this.ready) return;
    const time = this.deps.now?.() ?? Date.now();
    if (time - (this.cooldowns.get(id) ?? -Infinity) < this.config.sfxCooldownMs) return;
    const count = [...this.voices].filter(v => v.bus === 'sfx' && !v.stopped).length;
    if (count + this.pendingEffects >= this.config.maxVoices) return;
    this.cooldowns.set(id, time);
    // 由觸發當下計算延遲；載入耗時包含在內，不再額外等一次。
    const startAt = this.context.currentTime + Math.max(0, this.config.sounds[id]?.delayMs ?? 0) / 1000;
    const epoch = this.epoch;
    const effectsEpoch = this.effectsEpoch;
    const version = this.effectVersions.get(id) ?? 0;
    this.pendingEffects++;
    try {
      const buffer = await this.load(id);
      if (!this.ready || epoch !== this.epoch || effectsEpoch !== this.effectsEpoch ||
          version !== (this.effectVersions.get(id) ?? 0)) return;
      this.makeVoice(buffer, id, 'sfx', false, clamp(this.config.sounds[id].gain ?? 1), () => {
        if (this.ready && epoch === this.epoch && effectsEpoch === this.effectsEpoch &&
            version === (this.effectVersions.get(id) ?? 0)) onComplete?.();
      }, 0, startAt);
    } catch (error) {
      this.report('error', error.message);
    } finally {
      this.pendingEffects--;
    }
  }

  clearPausedMusic() {
    this.pausedMusic = null;
  }

  pauseMusic(id) {
    if (!this.ready || !id || this.musicId !== id) return;
    const voice = this.musicVoice;
    const duration = voice?.source.loopEnd || voice?.source.buffer.duration || 0;
    const elapsed = voice ? voice.offset + Math.max(0, this.context.currentTime - voice.startedAt) : (this.pendingMusicOffset ?? 0);
    // 記錄按下暫停當下的位置，不把淡出尾音或暫停時間算進進度。
    this.pausedMusic = { id, offset: loopPosition(elapsed, duration, voice?.source.loopStart ?? 0), voice };
    this.musicGeneration++; // 若仍在載入，取消舊的播放請求。
    this.musicId = null;
    this.musicVoice = null;
    this.stopVoice(voice, this.config.fadeMs);
    this.report('music', '');
  }

  async setMusic(id, { resume = false } = {}) {
    if (!this.ready || id === this.musicId) return;
    const saved = resume && this.pausedMusic?.id === id ? this.pausedMusic : null;
    if (id) this.clearPausedMusic();
    // 快速 PAUSE → RESUME 時，取消尚未結束的淡出尾音，避免同曲疊播。
    if (saved?.voice) {
      try { saved.voice.source.stop(); } catch {}
      saved.voice.source.disconnect();
      saved.voice.gain.disconnect();
      this.voices.delete(saved.voice);
    }
    this.musicId = id;
    this.pendingMusicOffset = saved?.offset ?? 0;
    const generation = ++this.musicGeneration;
    const previous = this.musicVoice;
    this.musicVoice = null;
    this.stopVoice(previous, this.config.fadeMs);
    this.report('music', id ?? '');
    if (!id) return;
    try {
      const buffer = await this.load(id);
      if (!this.ready || generation !== this.musicGeneration) return;
      const prepared = this.prepareMusicLoop(id, buffer);
      const loopEnd = prepared.loopEnd ?? prepared.buffer.duration;
      const offset = loopPosition(saved?.offset ?? 0, loopEnd, prepared.loopStart);
      const voice = this.makeVoice(prepared.buffer, id, 'bgm', this.config.sounds[id].loop !== false,
        0, null, offset, this.context.currentTime, prepared.loopStart, loopEnd);
      this.musicVoice = voice;
      const now = this.context.currentTime;
      const fadeInMs = this.config.sounds[id].fadeInMs ?? this.config.fadeMs;
      voice.gain.gain.setValueAtTime(0, now);
      voice.gain.gain.linearRampToValueAtTime(
        clamp(this.config.sounds[id].gain ?? 1),
        now + Math.max(0, fadeInMs) / 1000,
      );
    } catch (error) {
      if (generation === this.musicGeneration) {
        this.musicId = null;
        this.report('music', '');
      }
      this.report('error', error.message);
    }
  }

  stopEffects(id = null) {
    if (id === null) this.effectsEpoch++;
    else this.effectVersions.set(id, (this.effectVersions.get(id) ?? 0) + 1);
    for (const voice of this.voices) {
      if (voice.bus !== 'sfx' || (id !== null && voice.id !== id)) continue;
      this.stopVoice(voice);
    }
  }

  stopAll() {
    this.clearPausedMusic();
    this.pendingMusicOffset = 0;
    this.epoch++;
    this.musicGeneration++;
    this.musicId = null;
    this.musicVoice = null;
    this.cooldowns.clear();
    for (const voice of this.voices) {
      // 即使正在淡出，也立即終止，不等原排程；不可當作自然播完。
      voice.stopped = true;
      this.releaseDuck(voice);
      try { voice.source.stop(); } catch {}
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    this.report('music', '');
  }

  disable() {
    this.ready = false;
    this.stopAll();
    // 不強制 suspend：立即再次啟用時避免 suspend/resume 非同步競爭。
    // 無活動 source 時不會輸出聲音。
  }
}
