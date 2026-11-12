import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { playOrderAlert, unlockSound } from "@/lib/sound";
import { api, errorText } from "@/lib/api";
import { buildMenu } from "@/lib/menu";
import type { AppStatus, MenuCategory, MenuSnapshot } from "@/lib/types";

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };

type Ctx = {
  status: AppStatus | null;
  refreshStatus: () => Promise<void>;
  snapshot: MenuSnapshot | null;
  /** Carta para vender: solo activo, con productos. */
  menu: MenuCategory[];
  menuSource: "cloud" | "cache" | null;
  menuError: string | null;
  reloadMenu: (fromCloud?: boolean) => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);
  const [menuSource, setMenuSource] = useState<"cloud" | "cache" | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.appStatus());
    } catch {
      /* el backend siempre responde; ignorar */
    }
  }, []);

  const reloadMenu = useCallback(async (fromCloud = false) => {
    try {
      const res = await api.getMenu(fromCloud);
      if (res.snapshot) {
        setSnapshot({ ...res.snapshot, promotions: res.snapshot.promotions ?? [] });
      }
      setMenuSource(res.source);
      setMenuError(res.error);
    } catch (e) {
      setMenuError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void reloadMenu(true);
    const id = setInterval(refreshStatus, 5000);

    // El worker de Rust avisa cuando baja un menú nuevo o sincroniza pedidos
    // Pedido web nuevo: suena en cualquier pantalla, no solo en Cocina
    const unlisten = Promise.all([
      listen("menu-updated", () => void reloadMenu(false)),
      listen("orders-synced", () => void refreshStatus()),
      listen("web-order", () => playOrderAlert()),
    ]);
    // El audio necesita un toque previo del cajero para poder sonar
    const desbloquear = () => unlockSound();
    window.addEventListener("pointerdown", desbloquear, { once: true });
    window.addEventListener("keydown", desbloquear, { once: true });
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", desbloquear);
      window.removeEventListener("keydown", desbloquear);
      void unlisten.then((fns) => fns.forEach((f) => f()));
    };
  }, [refreshStatus, reloadMenu]);

  const menu = useMemo(() => (snapshot ? buildMenu(snapshot, { onlyActive: true }) : []), [snapshot]);

  const value = useMemo<Ctx>(
    () => ({ status, refreshStatus, snapshot, menu, menuSource, menuError, reloadMenu, toasts, toast }),
    [status, refreshStatus, snapshot, menu, menuSource, menuError, reloadMenu, toasts, toast],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp fuera de <AppProvider>");
  return ctx;
}
