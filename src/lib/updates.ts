import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Busca una versión nueva del POS en GitHub. Si hay, pregunta antes de instalarla
 * (así no se reinicia en medio de una venta). Sin internet no pasa nada: sigue andando.
 */
export async function buscarActualizacion(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    const ok = window.confirm(
      `Hay una versión nueva del POS (${update.version}).\n\n¿Actualizar ahora? El programa se reinicia solo.`,
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn("[actualizaciones]", e);
  }
}
