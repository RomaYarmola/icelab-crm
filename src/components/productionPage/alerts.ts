/**
 * Сигнал про нове замовлення (D65): короткий звук і вібрація. Браузер дозволяє звук лише після
 * першого дотику до сторінки, тому вмикається він кнопкою. Вібрації на iPhone немає, там вона
 * мовчки нічого не робить.
 */

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Ctor) return null;
  audioContext ??= new Ctor();
  return audioContext;
}

/** Два коротких тони. Викликайте після дотику користувача (кнопка «Звук»), інакше браузер промовчить. */
export function playAlertSound(): void {
  try {
    const ctx = context();
    if (!ctx) return;
    void ctx.resume();
    const start = ctx.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, start + index * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.22 + 0.18);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + index * 0.22);
      oscillator.stop(start + index * 0.22 + 0.2);
    });
  } catch {
    // Звук не вдався: екран усе одно підсвітить нове замовлення.
  }
}

export function vibrateAlert(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Вібрації немає.
  }
}
