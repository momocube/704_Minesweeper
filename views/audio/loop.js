/**
 * 預先混合尾段與開頭，讓原生 AudioBufferSource.loop 可無縫循環。
 * 首輪從 0 播，最後 crossfade 秒混入開頭；下輪從 crossfade 秒接續。
 * 不使用 JS 計時器，背景分頁也由音訊時鐘連續播放。原始 buffer 不修改。
 */
export function buildCrossfadeLoop(context, original, durationMs) {
  const requested = Math.max(0, Number(durationMs) || 0) / 1000;
  if (requested === 0) return { buffer: original, loopStart: 0, crossfadeSeconds: 0 };
  const frames = Math.min(Math.round(requested * original.sampleRate), Math.floor(original.length / 4));
  if (frames < 2) return { buffer: original, loopStart: 0, crossfadeSeconds: 0 };
  const buffer = context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
  const tail = original.length - frames;
  for (let channel = 0; channel < original.numberOfChannels; channel++) {
    const input = original.getChannelData(channel);
    const output = buffer.getChannelData(channel);
    output.set(input);
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      const fadeIn = t * t * (3 - 2 * t);
      // 互補 S 曲線，權重合計 1，避免相同片段重疊時音量翻倍。
      output[tail + i] = input[tail + i] * (1 - fadeIn) + input[i] * fadeIn;
    }
  }
  const seconds = frames / original.sampleRate;
  return { buffer, loopStart: seconds, crossfadeSeconds: seconds };
}

/** 原生 loopStart 不為 0 時，暫停位置需按較短的實際循環長度換算。 */
export function loopPosition(elapsed, duration, loopStart = 0) {
  if (!(duration > 0)) return Math.max(0, elapsed);
  if (elapsed < duration) return Math.max(0, elapsed);
  const start = Math.max(0, Math.min(loopStart, duration - Number.EPSILON));
  return start + (elapsed - duration) % (duration - start);
}
