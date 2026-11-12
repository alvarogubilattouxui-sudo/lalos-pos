import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Megaphone, Power, Search } from "lucide-react";
import { api, errorText, type HorarioRow, type TiendaRow } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { OptionRow, ProductRow } from "@/lib/types";
import { cn } from "@/lib/format";

/** Lunes primero, domingo al final (igual que en la landing). */
const ORDEN = [1, 2, 3, 4, 5, 6, 0];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const AVISO_MAX = 200;

/** Postgres devuelve "19:00:00"; el input type=time quiere "19:00". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

const boton = "rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40";
const chip = "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40";
const seccion = "rounded-2xl border border-asphalt-light bg-asphalt p-5";

/**
 * Pantalla "Local": lo que hay que tocar rápido durante el día.
 * - Cerrar / abrir la tienda ahora (corta los pedidos web).
 * - Aviso que se muestra arriba de la carta.
 * - Horarios por día de la semana.
 * - Marcar productos y opciones como agotados.
 * Todo se escribe en Supabase (vía Rust) y la landing lo recibe por Realtime.
 */
export default function LocalScreen() {
  const { snapshot, status, toast } = useApp();
  const [horarios, setHorarios] = useState<HorarioRow[]>([]);
  const [tienda, setTienda] = useState<TiendaRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [q, setQ] = useState("");

  const canEdit = Boolean(status?.logged_in && status.online);

  const load = useCallback(async () => {
    try {
      const res = await api.getStoreState();
      setHorarios([...res.horarios].sort((a, b) => a.dia_semana - b.dia_semana));
      setTienda(res.tienda[0] ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAviso(tienda?.aviso ?? "");
  }, [tienda?.aviso]);

  /** Ejecuta un cambio, avisa el resultado y vuelve a leer el estado de la tienda. */
  const run = async (key: string, cambio: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    try {
      await cambio();
      toast(okText);
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const toggleCerrado = () => {
    if (!tienda) return;
    const cerrar = !tienda.cerrado_ahora;
    void run(
      "cerrado",
      () => api.adminUpdate<TiendaRow>("tienda", tienda.id, { cerrado_ahora: cerrar }),
      cerrar ? "Tienda cerrada: la web no acepta pedidos" : "Tienda abierta: la web vuelve a aceptar pedidos",
    );
  };

  const guardarAviso = (texto: string | null) => {
    if (!tienda) return;
    void run(
      "aviso",
      () => api.adminUpdate<TiendaRow>("tienda", tienda.id, { aviso: texto }),
      texto ? "Aviso publicado" : "Aviso quitado",
    );
  };

  const guardarDia = (h: HorarioRow, abre: string | null, cierra: string | null) =>
    void run(
      `dia-${h.id}`,
      () => api.adminUpdate<HorarioRow>("horarios", h.id, { abre, cierra }),
      `${DIAS[h.dia_semana]} actualizado`,
    );

  const toggleProducto = (p: ProductRow) =>
    void run(
      `prod-${p.id}`,
      () => api.adminUpdate<ProductRow>("products", p.id, { available: !p.available }),
      `${p.name}: ${p.available ? "AGOTADO" : "disponible"}`,
    );

  const toggleOpcion = (o: OptionRow) =>
    void run(
      `opt-${o.id}`,
      () => api.adminUpdate<OptionRow>("options", o.id, { available: !o.available }),
      `${o.name}: ${o.available ? "AGOTADO" : "disponible"}`,
    );

  const categorias = useMemo(
    () => [...(snapshot?.categories ?? [])].sort((a, b) => a.display_order - b.display_order),
    [snapshot],
  );
  const grupos = useMemo(
    () => [...(snapshot?.option_groups ?? [])].sort((a, b) => a.display_order - b.display_order),
    [snapshot],
  );

  const term = q.trim().toLowerCase();
  const coincide = (texto: string) => !term || texto.toLowerCase().includes(term);

  const sinCambios = !canEdit || !tienda;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <h1 className="title text-4xl">Local</h1>
          <p className="text-sm text-smoke">Cambios rápidos de la tienda. Se publican en la web al instante.</p>
        </header>

        {!canEdit && (
          <div className="rounded-xl bg-mustard/15 px-4 py-3 text-sm text-mustard">
            Para cambiar algo hace falta conexión a internet y sesión iniciada (pantalla Config).
          </div>
        )}
        {loadError && (
          <div className="rounded-xl bg-ketchup/20 px-4 py-3 text-sm text-[#ff8a7a]">
            No se pudo leer el estado de la tienda: {loadError}
          </div>
        )}

        {/* Abierto / cerrado ahora */}
        <section className={seccion}>
          <h2 className="title text-2xl">Estado ahora</h2>
          <p className="mt-1 text-sm text-smoke">
            Cerrar ahora no cambia los horarios: la web muestra "Cerrados" y no acepta pedidos hasta que la reabras.
          </p>
          <button
            type="button"
            onClick={toggleCerrado}
            disabled={sinCambios || busy === "cerrado"}
            className={cn(
              "mt-4 flex w-full items-center justify-center gap-3 rounded-2xl py-5 font-display text-2xl uppercase tracking-poster transition-colors disabled:opacity-40",
              tienda?.cerrado_ahora
                ? "bg-ketchup text-bone hover:bg-ketchup/80"
                : "bg-emerald-500 text-carbon hover:bg-emerald-400",
            )}
          >
            <Power className="h-7 w-7" />
            {!tienda
              ? "Cargando…"
              : tienda.cerrado_ahora
                ? "Cerrado a mano · tocá para reabrir"
                : "Abierto · tocá para cerrar ahora"}
          </button>
        </section>

        {/* Aviso en la carta */}
        <section className={seccion}>
          <h2 className="title flex items-center gap-2 text-2xl">
            <Megaphone className="h-5 w-5" /> Aviso en la carta
          </h2>
          <p className="mt-1 text-sm text-smoke">
            Se muestra arriba de la carta en la web. Ej.: "Hoy cerramos a las 21:30".
          </p>
          <textarea
            value={aviso}
            onChange={(e) => setAviso(e.target.value.slice(0, AVISO_MAX))}
            rows={2}
            disabled={sinCambios}
            placeholder="Sin aviso"
            className="mt-3 w-full resize-none rounded-xl bg-asphalt-light px-3 py-2 text-bone placeholder:text-smoke/60 disabled:opacity-40"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-smoke">
              {aviso.length}/{AVISO_MAX}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => guardarAviso(null)}
                disabled={sinCambios || !tienda?.aviso || busy === "aviso"}
                className={cn(boton, "bg-asphalt-light text-bone hover:bg-asphalt-lighter")}
              >
                Quitar aviso
              </button>
              <button
                type="button"
                onClick={() => guardarAviso(aviso.trim() || null)}
                disabled={sinCambios || busy === "aviso"}
                className={cn(boton, "bg-flame text-carbon hover:bg-flame/90")}
              >
                Publicar aviso
              </button>
            </div>
          </div>
        </section>

        {/* Horarios */}
        <section className={seccion}>
          <h2 className="title flex items-center gap-2 text-2xl">
            <Clock className="h-5 w-5" /> Horarios
          </h2>
          <p className="mt-1 text-sm text-smoke">
            Horario fijo de cada día. Para cerrar solo por hoy usá el botón de arriba.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {ORDEN.map((d) => {
              const h = horarios.find((x) => x.dia_semana === d);
              if (!h) return null;
              return (
                <HorarioFila
                  key={`${h.id}-${h.abre}-${h.cierra}`}
                  h={h}
                  disabled={sinCambios || busy === `dia-${h.id}`}
                  onGuardar={(abre, cierra) => guardarDia(h, abre, cierra)}
                />
              );
            })}
            {horarios.length === 0 && <p className="text-sm text-smoke">Cargando horarios…</p>}
          </div>
        </section>

        {/* Agotados */}
        <section className={seccion}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="title text-2xl">Agotar productos y opciones</h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-smoke" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar"
                className="rounded-xl bg-asphalt-light py-2 pl-9 pr-3 text-sm text-bone placeholder:text-smoke/60"
              />
            </div>
          </div>
          <p className="mt-1 text-sm text-smoke">Tocá para marcar agotado o volver a disponible.</p>

          {!snapshot && <p className="mt-4 text-sm text-smoke">Cargando el menú…</p>}

          {snapshot && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-smoke">Productos</h3>
              {categorias.map((c) => {
                const prods = snapshot.products.filter((p) => p.category_id === c.id && coincide(p.name));
                if (prods.length === 0) return null;
                return (
                  <div key={c.id} className="mt-3">
                    <p className="mb-2 text-sm font-semibold text-mustard">{c.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {prods.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleProducto(p)}
                          disabled={sinCambios || busy === `prod-${p.id}`}
                          className={cn(
                            chip,
                            p.available
                              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                              : "bg-ketchup text-bone hover:bg-ketchup/80",
                          )}
                        >
                          {p.name}
                          {!p.available && " · AGOTADO"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-smoke">Opciones y extras</h3>
              {grupos.map((g) => {
                const ops = snapshot.options.filter(
                  (o) => o.group_id === g.id && (coincide(o.name) || coincide(g.name)),
                );
                if (ops.length === 0) return null;
                return (
                  <div key={g.id} className="mt-3">
                    <p className="mb-2 text-sm font-semibold text-mustard">{g.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {ops.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleOpcion(o)}
                          disabled={sinCambios || busy === `opt-${o.id}`}
                          className={cn(
                            chip,
                            o.available
                              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                              : "bg-ketchup text-bone hover:bg-ketchup/80",
                          )}
                        >
                          {o.name}
                          {!o.available && " · AGOTADO"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Una fila de horario: abre/cierra o día cerrado. La clave del padre la reinicia al recargar. */
function HorarioFila({
  h,
  disabled,
  onGuardar,
}: {
  h: HorarioRow;
  disabled: boolean;
  onGuardar: (abre: string | null, cierra: string | null) => void;
}) {
  const { toast } = useApp();
  const [abierto, setAbierto] = useState(h.abre !== null);
  const [abre, setAbre] = useState(hhmm(h.abre) || "19:00");
  const [cierra, setCierra] = useState(hhmm(h.cierra) || "22:30");

  const guardar = () => {
    if (!abierto) {
      onGuardar(null, null);
      return;
    }
    if (!abre || !cierra || cierra <= abre) {
      toast("La hora de cierre tiene que ser posterior a la de apertura", "error");
      return;
    }
    onGuardar(abre, cierra);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-asphalt-light/60 px-4 py-3">
      <span className="w-28 font-semibold text-bone">{DIAS[h.dia_semana]}</span>
      <label className="flex items-center gap-2 text-sm text-smoke">
        <input
          type="checkbox"
          checked={abierto}
          onChange={(e) => setAbierto(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 accent-flame"
        />
        Abre
      </label>
      <input
        type="time"
        value={abre}
        onChange={(e) => setAbre(e.target.value)}
        disabled={disabled || !abierto}
        className="rounded-lg bg-asphalt px-2 py-1.5 text-bone disabled:opacity-40"
      />
      <span className="text-smoke">a</span>
      <input
        type="time"
        value={cierra}
        onChange={(e) => setCierra(e.target.value)}
        disabled={disabled || !abierto}
        className="rounded-lg bg-asphalt px-2 py-1.5 text-bone disabled:opacity-40"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={disabled}
        className={cn(boton, "ml-auto bg-flame text-carbon hover:bg-flame/90")}
      >
        Guardar
      </button>
    </div>
  );
}
