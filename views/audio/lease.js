/** 同來源、同瀏覽器設定檔內的播放互斥。不使用 localStorage 或持久化資料。 */
export class PlaybackLease {
  constructor(locks = globalThis.navigator?.locks) {
    this.locks = locks;
    this.releaseLock = null;
  }

  acquire() {
    if (!this.locks) return Promise.reject(new Error('無法使用分頁互斥。請以 localhost 開啟 Chrome 或 Edge。'));
    if (this.releaseLock) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      this.locks.request('704-minesweeper-audio-output', { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        return new Promise(release => {
          this.releaseLock = release;
          resolve(true);
        });
      }).catch(reject);
    });
  }

  release() {
    this.releaseLock?.();
    this.releaseLock = null;
  }
}
