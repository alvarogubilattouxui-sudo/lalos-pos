import { useEffect, useState } from "react";
import { Cloud, LogIn, LogOut, Printer, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { AvailablePrinters, PrinterConfig, PrinterTarget } from "@/lib/types";
import { cn } from "@/lib/format";

export default function SettingsScreen() {
  return (
    <div className="scroll-thin h-full overflow-y-auto p-6">
      <h1 className="title mb-6 text-5xl">Configuración</h1>
      <div className="grid max-w-6xl gap-6 xl:grid-cols-2">
        <SupabaseCard />
        <PrinterCard />
      </div>
    </div>
  );
}

/* ---------------- Supabase + sesión ---------------- */

function SupabaseCard() {
  const { status, refreshStatus, reloadMenu, toast } = useApp();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status?.supabase_url && !url) setUrl(status.supabase_url);
  }, [status?.supabase_url, url]);

  const saveConfig = async () => {
    try {
      await api.saveSupabaseConfig(url, anonKey);
      setAnonKey("");
      toast("Conexión guardada");
      await refreshStatus();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const login = async () => {
    setBusy(true);
    try {
      const who = await api.login(email, password);
      setPassword("");
      toast(`Sesión iniciada: ${who}`);
      await refreshStatus();
      await reloadMenu(true);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.logout();
    toast("Sesión cerrada", "info");
    await refreshStatus();
  };

  return (
    <section className="card space-y-5 p-6">
      <header className="flex items-center gap-3">
        <Cloud className="h-6 w-6 text-flame" />
        <h2 className="title text-3xl">Nube (Supabase)</h2>
        <span className={cn("ml-auto rounded-full px-3 py-1 text-xs font-bold", status?.online ? "bg-emerald-500/20 text-emerald-700" : "bg-ketchup/20 text-ketchup")}>
          {status?.online ? "En línea" : "Sin conexión"}
        </span>
      </header>

      <div className="space-y-3">
        <div>
          <label className="label">URL del proyecto</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
        </div>
        <div>
          <label className="label">Anon / publishable key</label>
          <input
            className="input font-mono text-xs"
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder={status?.supabase_configured ? "•••• guardada (pegá otra para cambiarla)" : "eyJhbGciOi… o sb_publishable_…"}
          />
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-smoke">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            Es la clave pública (la misma de la web). La service_role NO va en el POS: la app la rechaza.
          </p>
        </div>
        <button type="button" onClick={() => void saveConfig()} disabled={!url || !anonKey} className="btn-ghost">
          <Save className="h-4 w-4" /> Guardar conexión
        </button>
      </div>

      <hr className="border-asphalt-light" />

      {status?.logged_in ? (
        <div className="flex items-center justify-between rounded-xl bg-carbon p-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-smoke">Sesión iniciada</p>
            <p className="font-semibold">{status.user_email}</p>
          </div>
          <button type="button" onClick={() => void logout()} className="btn-ghost">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <p className="text-sm text-smoke">Usuario de la caja (creado en Supabase → Authentication y dado de alta en la tabla staff).</p>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="caja@lalosburgas.com.ar" />
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
          <button type="submit" disabled={busy || !email || !password || !status?.supabase_configured} className="btn-primary">
            <LogIn className="h-4 w-4" /> {busy ? "Entrando…" : "Iniciar sesión"}
          </button>
        </form>
      )}

      <div className="flex items-center justify-between rounded-xl bg-carbon p-4 text-sm">
        <div>
          <p>
            Pedidos sin subir: <strong>{status?.pending_sync ?? 0}</strong>
          </p>
          <p className="text-xs text-smoke">
            Menú actualizado: {status?.last_menu_sync ? new Date(status.last_menu_sync).toLocaleString("es-AR") : "nunca"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void api.syncNow();
            toast("Sincronizando…", "info");
          }}
          className="btn-ghost"
        >
          <RefreshCw className="h-4 w-4" /> Sincronizar ahora
        </button>
      </div>
    </section>
  );
}

/* ---------------- Impresora ---------------- */

const DEFAULT_TARGETS: Record<PrinterTarget["kind"], PrinterTarget> = {
  windows: { kind: "windows", name: "" },
  serial: { kind: "serial", port: "COM3", baud: 9600 },
  network: { kind: "network", host: "192.168.0.100", port: 9100 },
};

function PrinterCard() {
  const { toast } = useApp();
  const [cfg, setCfg] = useState<PrinterConfig | null>(null);
  const [available, setAvailable] = useState<AvailablePrinters>({ windows: [], serial: [] });
  const [busy, setBusy] = useState(false);

  const scan = () => api.listPrinters().then(setAvailable).catch(() => undefined);

  useEffect(() => {
    void api.getPrinterConfig().then(setCfg).catch((e) => toast(errorText(e), "error"));
    void scan();
  }, [toast]);

  if (!cfg) return <section className="card p-6 text-smoke">Cargando impresora…</section>;

  const target = cfg.target;
  const setTarget = (t: PrinterTarget | null) => setCfg({ ...cfg, target: t });
  const set = <K extends keyof PrinterConfig>(k: K, v: PrinterConfig[K]) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    try {
      await api.savePrinterConfig(cfg);
      toast("Impresora guardada");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await api.printTest(cfg);
      toast("Página de prueba enviada");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-5 p-6">
      <header className="flex items-center gap-3">
        <Printer className="h-6 w-6 text-flame" />
        <h2 className="title text-3xl">Impresora térmica</h2>
        <button type="button" onClick={() => void scan()} className="btn-ghost ml-auto px-3 py-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Buscar
        </button>
      </header>

      <div>
        <label className="label">Conexión</label>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              [null, "Ninguna"],
              ["windows", "USB (Windows)"],
              ["serial", "Serie (COM)"],
              ["network", "Red (IP)"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setTarget(kind ? (target?.kind === kind ? target : DEFAULT_TARGETS[kind]) : null)}
              className={cn("btn", (target?.kind ?? null) === kind ? "bg-flame text-azul-d" : "bg-asphalt-light")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {target?.kind === "windows" && (
        <div>
          <label className="label">Impresora instalada</label>
          <select className="input" value={target.name} onChange={(e) => setTarget({ ...target, name: e.target.value })}>
            <option value="">Elegí una…</option>
            {available.windows.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-smoke">
            Instalá la impresora en Windows con el driver del fabricante (o “Generic / Text Only”). El POS le manda los comandos ESC/POS en modo RAW.
          </p>
        </div>
      )}

      {target?.kind === "serial" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Puerto</label>
            <select className="input" value={target.port} onChange={(e) => setTarget({ ...target, port: e.target.value })}>
              {Array.from(new Set([target.port, ...available.serial])).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Velocidad (baudios)</label>
            <select className="input" value={target.baud} onChange={(e) => setTarget({ ...target, baud: Number(e.target.value) })}>
              {[9600, 19200, 38400, 115200].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {target?.kind === "network" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label">IP de la impresora</label>
            <input className="input" value={target.host} onChange={(e) => setTarget({ ...target, host: e.target.value.trim() })} />
          </div>
          <div>
            <label className="label">Puerto</label>
            <input className="input" type="number" value={target.port} onChange={(e) => setTarget({ ...target, port: Number(e.target.value) || 9100 })} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Ancho de papel</label>
          <div className="grid grid-cols-2 gap-2">
            {([58, 80] as const).map((w) => (
              <button key={w} type="button" onClick={() => set("paper_width", w)} className={cn("btn", cfg.paper_width === w ? "bg-flame text-azul-d" : "bg-asphalt-light")}>
                {w} mm
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Copias de comanda</label>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" onClick={() => set("kitchen_copies", n)} className={cn("btn", cfg.kitchen_copies === n ? "bg-flame text-azul-d" : "bg-asphalt-light")}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-carbon p-4 text-sm">
        <Check label="Imprimir comanda de cocina al cobrar" on={cfg.auto_print_kitchen} onChange={(v) => set("auto_print_kitchen", v)} />
        <Check label="Imprimir ticket para el cliente al cobrar" on={cfg.auto_print_receipt} onChange={(v) => set("auto_print_receipt", v)} />
        <Check label="Abrir cajón de dinero en pagos en efectivo" on={cfg.open_drawer_on_cash} onChange={(v) => set("open_drawer_on_cash", v)} />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => void test()} disabled={!target || busy} className="btn-ghost">
          <Printer className="h-4 w-4" /> {busy ? "Imprimiendo…" : "Imprimir prueba"}
        </button>
        <button type="button" onClick={() => void save()} className="btn-primary ml-auto">
          <Save className="h-4 w-4" /> Guardar
        </button>
      </div>
    </section>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#FF5F1F]" />
      {label}
    </label>
  );
}
