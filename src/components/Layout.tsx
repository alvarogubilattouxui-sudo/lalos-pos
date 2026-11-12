import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ChefHat, CloudOff, Cloud, Maximize2, RefreshCw, Settings, ShoppingCart, Store, UtensilsCrossed } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { BrandLogo } from "@/components/BrandLogo";

const NAV = [
  { to: "/", label: "Caja", icon: ShoppingCart, key: "F1" },
  { to: "/cocina", label: "Cocina", icon: ChefHat, key: "F2" },
  { to: "/menu", label: "Menú", icon: UtensilsCrossed, key: "F3" },
  { to: "/config", label: "Config", icon: Settings, key: "F4" },
  { to: "/local", label: "Local", icon: Store, key: "F5" },
] as const;

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="title text-2xl text-bone/90">
      {now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function Layout() {
  const { status, toasts } = useApp();
  const navigate = useNavigate();

  // Atajos: F1-F5 cambian de pantalla, F11 pantalla completa
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const idx = ["F1", "F2", "F3", "F4", "F5"].indexOf(e.key);
      if (idx >= 0) {
        e.preventDefault();
        navigate(NAV[idx].to);
      }
      if (e.key === "F11") {
        e.preventDefault();
        const w = getCurrentWindow();
        await w.setFullscreen(!(await w.isFullscreen()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const online = status?.online ?? false;
  const loggedIn = status?.logged_in ?? false;

  return (
    <div className="flex h-full">
      {/* Barra lateral */}
      <nav className="flex w-24 shrink-0 flex-col items-center gap-2 border-r border-asphalt-light bg-asphalt py-4">
        <div className="mb-4 flex flex-col items-center gap-1.5 px-2">
          <BrandLogo className="h-auto w-20" />
          <span className="rounded-sm bg-naranja px-1.5 font-display text-xs uppercase tracking-poster text-papel">POS</span>
        </div>

        {NAV.map(({ to, label, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "group flex w-20 flex-col items-center gap-1 rounded-2xl py-3 transition-colors",
                isActive ? "bg-flame text-azul-d" : "text-smoke hover:bg-asphalt-light hover:text-bone",
              )
            }
          >
            <Icon className="h-7 w-7" />
            <span className="text-xs font-semibold">{label}</span>
            <span className="text-[10px] opacity-60">{key}</span>
          </NavLink>
        ))}

        <div className="mt-auto flex flex-col items-center gap-3">
          <button
            type="button"
            title="Pantalla completa (F11)"
            onClick={async () => {
              const w = getCurrentWindow();
              await w.setFullscreen(!(await w.isFullscreen()));
            }}
            className="rounded-xl p-2 text-smoke hover:bg-asphalt-light hover:text-bone"
          >
            <Maximize2 className="h-5 w-5" />
          </button>
          <Clock />
        </div>
      </nav>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-4 border-b border-asphalt-light px-4 text-xs">
          <span className={cn("flex items-center gap-1.5 font-semibold", online ? "text-emerald-700" : "text-ketchup")}>
            {online ? <Cloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
            {online ? "En línea" : "Sin conexión · la caja sigue funcionando"}
          </span>
          {status && status.pending_sync > 0 && (
            <button
              type="button"
              onClick={() => void api.syncNow()}
              className="flex items-center gap-1.5 text-mustard hover:underline"
              title="Pedidos guardados localmente que todavía no subieron a la nube"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {status.pending_sync} por sincronizar
            </button>
          )}
          <span className="ml-auto text-smoke">
            {!status?.supabase_configured ? (
              <NavLink to="/config" className="text-mustard hover:underline">
                Configurar Supabase
              </NavLink>
            ) : loggedIn ? (
              status?.user_email
            ) : (
              <NavLink to="/config" className="text-mustard hover:underline">
                Iniciar sesión
              </NavLink>
            )}
          </span>
        </header>

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto max-w-lg rounded-xl px-5 py-3 text-sm font-semibold shadow-2xl",
              t.kind === "ok" && "bg-emerald-500 text-azul-d",
              t.kind === "error" && "bg-ketchup text-papel",
              t.kind === "info" && "bg-asphalt-lighter text-bone",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
