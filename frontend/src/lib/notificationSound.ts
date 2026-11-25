const preferenceKey = "bantai:notification-sounds";

export function notificationSoundsEnabled() {
  try { return localStorage.getItem(preferenceKey) === "on"; }
  catch { return false; }
}

let audio: AudioContext | undefined;

export function setNotificationSounds(enabled: boolean) {
  try { localStorage.setItem(preferenceKey, enabled ? "on" : "off"); } catch { /* Storage is optional. */ }
  if (enabled) prepareNotificationAudio();
  else if (audio?.state === "running") void audio.suspend().catch(() => {});
}

export function prepareNotificationAudio() {
  if (!notificationSoundsEnabled()) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch { /* Audio is optional. */ }
}

const frequencies = { success: [523, 659], error: [349, 294], warning: [440] };

export function playNotificationSound(type: keyof typeof frequencies) {
  if (!notificationSoundsEnabled() || audio?.state !== "running") return;
  const context = audio;
  try {
    frequencies[type].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.035, start + 0.015);
      gain.gain.linearRampToValueAtTime(0, start + 0.09);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.095);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* Toasts remain available when audio fails. */ }
}
