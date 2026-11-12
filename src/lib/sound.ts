/**
 * Aviso sonoro de pedidos web. El WebView no deja sonar hasta que el usuario toca algo,
 * así que se habilita con el primer toque (unlockSound) y el contexto se reutiliza.
 */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch {
    return null; // sin audio: el pedido igual aparece en pantalla
  }
}

/** Llamar con el primer toque o tecla en la app. */
export function unlockSound() {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

/** Tres pitidos para que se note en la cocina o en la caja. */
export function playOrderAlert() {
  const c = getCtx();
  if (!c) return;
  const tocar = () => {
    [0, 0.35, 0.7].forEach((t) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = 988;
      gain.gain.setValueAtTime(0.4, c.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.25);
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + t);
      osc.stop(c.currentTime + t + 0.3);
    });
  };
  if (c.state === "suspended") void c.resume().then(tocar);
  else tocar();
}
