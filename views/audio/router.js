// 純事件轉譯，不傳送控制指令，也不修改原始遊戲訊息。
export class AudioRouter {
  constructor(config, engine, report = () => {}) {
    this.config = config;
    this.engine = engine;
    this.report = report;
    this.state = null;
    this.enabled = false;
    this.musicGateOpen = false;
    this.sequence = 0;
  }

  resetMusicGate() {
    this.sequence++;
    this.musicGateOpen = false;
  }

  get scene() {
    return this.state?.endStage || this.state?.phase || null;
  }

  syncMusic() {
    if (!this.enabled || !this.state) return;
    const scenes = this.config.phaseMusic;
    // endStage 可各自設定，未設定時回退到 gameOver 的設定。
    const id = Object.hasOwn(scenes, this.scene)
      ? scenes[this.scene] : scenes[this.state.phase];
    const gated = id && id === this.config.musicAfterEffect?.music && !this.musicGateOpen;
    if (this.state.phase === 'paused') this.engine.pauseMusic?.(scenes.playing);
    this.engine.setMusic(gated ? null : (id ?? null), { resume: this.state.phase === 'playing' });
  }

  previewVictory() {
    if (!this.enabled) return false;
    this.sequence++; // 取消測試前尚未完成的串接音效。
    this.engine.stopAll();
    // 使用獨立路由器模擬聲音，不改本路由器的真實遊戲快照。
    const preview = new AudioRouter(this.config, this.engine, (event, sound) => {
      this.report(`本機勝利測試：${event}`, sound, true);
    });
    preview.enable();
    preview.handle({ type: 'game-over', reason: 'win', won: true,
      snapshot: { phase: 'gameOver', endStage: 'win-ending' } });
    return true;
  }

  enable() {
    this.enabled = true;
    this.syncMusic(); // 只恢復目前階段音樂，不補播過去事件音效。
  }

  disable() {
    this.resetMusicGate();
    this.enabled = false;
    this.engine.stopAll();
  }

  disconnect() {
    this.resetMusicGate();
    this.state = null;
    this.engine.stopAll();
  }

  handle(message) {
    if (!message || typeof message.type !== 'string') return;
    const snapshot = message.type === 'snapshot' ? message : message.snapshot;
    if (['game-start', 'game-over', 'reset', 'armed'].includes(message.type) ||
        (snapshot?.phase && !['playing', 'paused'].includes(snapshot.phase))) {
      this.engine.clearPausedMusic?.();
    }
    const gate = this.config.musicAfterEffect;
    if (gate && (message.type === gate.event || ['reset', 'armed', 'game-over'].includes(message.type) ||
        (snapshot?.phase && !['intro', 'ready', 'tutorial', 'tutorialReady'].includes(snapshot.phase)))) {
      this.resetMusicGate();
      this.engine.stopEffects?.(gate.effect);
    }
    if (snapshot && typeof snapshot.phase === 'string') {
      this.state = { phase: snapshot.phase, endStage: snapshot.endStage ?? null, tutorialStep: snapshot.tutorialStep ?? null };
      this.syncMusic();
    }
    // 場景中斷時取消尚在載入或播放的舊音效，再播放新場景的提示。
    if (this.enabled && ['game-over', 'reset', 'armed'].includes(message.type)) {
      this.engine.stopEffects?.();
    } else if (this.enabled && this.state?.phase !== 'countdown') {
      this.engine.stopEffects?.('sfx_countdown');
    }
    // 連線快照、感應器校正訊息不是即時遊戲音效；未取得快照時不播。
    if (!this.state || message.type === 'snapshot' ||
        message.type.startsWith('lock-')) return;
    for (const rule of this.config.events[message.type] ?? []) {
      const matches = Object.entries(rule.when ?? {})
        .every(([key, value]) => message[key] === value) &&
        (rule.whenHas ?? []).every(key => Object.hasOwn(message, key));
      if (matches && rule.sound) {
        this.report(message.type, rule.sound, this.enabled);
        if (this.enabled) {
          const sequence = this.sequence;
          this.engine.playEffect(rule.sound, () => {
            if (!this.enabled || sequence !== this.sequence) return;
            if (gate && message.type === gate.event && rule.sound === gate.effect) {
              this.musicGateOpen = true;
              this.syncMusic();
            }
            if (rule.after && this.state?.phase === 'tutorial' && this.state.tutorialStep === 0) {
              this.report(`${message.type}（按鍵音結束）`, rule.after, true);
              this.engine.playEffect(rule.after);
            }
          });
        }
      }
    }
  }
}
