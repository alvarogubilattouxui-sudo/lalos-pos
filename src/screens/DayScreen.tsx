import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import { CobrarModal } from "@/components/CobrarModal";
import type { DaySummary, Order, ProductProfit } from "@/lib/types";
import { PAYMENT_LABELS, STATUS_LABELS, cn, formatPrice, formatTime, ticketNo } from "@/lib/format";

/** Ganancias y cobros del día: lo vendido, lo que costó, lo que queda y cómo se cobró. */
export default function DayScreen() {
  const { menu, toast } = useApp();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<ProductProfit[]>([]);
  const [cobrando, setCobrando] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, o, p] = await Promise.all([api.daySummary(), api.listTodayOrders(300), api.dayProducts()]);
      setSummary(s);
      setOrders(o);
      setProducts(p);
    } catch (e) {
      toast(errorText(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 4000);
    const unlisten = listen("web-order", () => void load());
    return () => {
      clearInterval(poll);
      void unlisten.then((fn) => fn());
    };
  }, [load]);

  // Productos y opciones con precio pero sin costo cargado: la ganancia sale inflada
  const sinCosto = useMemo(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const c of menu) {
      for (const p of c.products) {
        if (p.price > 0 && p.cost === 0 && !seen.has(p.id)) {
          seen.add(p.id);
          n++;
        }
        for (const g of p.optionGroups) {
          for (const o of g.options) {
            if (o.price > 0 && o.cost === 0 && !seen.has(o.id)) {
              seen.add(o.id);
              n++;
            }
          }
        }
      }
    }
    return n;
  }, [menu]);

  const margen = summary && summary.total > 0 ? Math.round((summary.profit / summary.total) * 100) : null;
  const fecha = summary
    ? new Date(`${summary.business_day}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
    : "";

  return (
    <div className="scroll-thin h-full overflow-y-auto p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title text-5xl">Día</h1>
          <p className="mt-1 text-smoke capitalize">{fecha}</p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-ghost">
          Actualizar
        </button>
      </header>

      {sinCosto > 0 && (
        <p className="mb-6 rounded-xl border border-mustard/50 bg-mustard/10 px-4 py-3 text-sm">
          Hay <strong>{sinCosto}</strong> producto(s) u opción(es) sin costo cargado: la ganancia sale más alta de lo real.
          Cargalos en <strong>Menú → Costos</strong>.
        </p>
      )}

      {summary && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Kpi label="Vendido" value={formatPrice(summary.total)} sub={`${summary.orders} pedidos`} />
            <Kpi label="Costo" value={formatPrice(summary.cost)} sub="productos y agregados" />
            <Kpi label="Ganancia neta" value={formatPrice(summary.profit)} sub={margen !== null ? `${margen}% de lo vendido` : undefined} destacada />
            <Kpi label="Cobrado" value={formatPrice(summary.paid_total)} />
            <Kpi
              label="Sin cobrar"
              value={formatPrice(summary.pending_total)}
              sub={`${summary.pending_orders} pedidos`}
              alerta={summary.pending_orders > 0}
            />
          </div>

          <section className="card mb-8 p-5">
            <h2 className="title mb-3 text-2xl">Cobrado por medio de pago</h2>
            {summary.by_payment.length === 0 ? (
              <p className="text-sm text-smoke">Todavía no se cobró nada hoy.</p>
            ) : (
              <ul className="divide-y divide-asphalt-light">
                {summary.by_payment.map((m) => (
                  <li key={m.method} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-semibold">{PAYMENT_LABELS[m.method]}</p>
                      <p className="text-xs text-smoke">
                        {m.orders} pedido(s)
                      </p>
                    </div>
                    <span className="title text-3xl text-flame">{formatPrice(m.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="card mb-8 overflow-hidden">
        <h2 className="title border-b border-asphalt-light px-5 py-4 text-2xl">Ganancia por producto</h2>
        {products.length === 0 ? (
          <p className="p-5 text-sm text-smoke">Todavía no hay ventas hoy.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-asphalt-light/60 text-left text-xs uppercase text-smoke">
              <tr>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2 text-right">Cantidad</th>
                <th className="px-4 py-2 text-right">Vendido</th>
                <th className="px-4 py-2 text-right">Costo</th>
                <th className="px-4 py-2 text-right">Ganancia</th>
                <th className="px-4 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-asphalt-light">
              {products.map((p) => (
                <tr key={p.name} className="hover:bg-asphalt/60">
                  <td className="px-4 py-2.5 font-semibold">{p.name}</td>
                  <td className="px-4 py-2.5 text-right">{p.quantity}</td>
                  <td className="px-4 py-2.5 text-right">{formatPrice(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-right text-smoke">{formatPrice(p.cost)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-flame">{formatPrice(p.profit)}</td>
                  <td className="px-4 py-2.5 text-right text-smoke">
                    {p.revenue > 0 ? `${Math.round((p.profit / p.revenue) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="title border-b border-asphalt-light px-5 py-4 text-2xl">Pedidos de hoy</h2>
        <table className="w-full text-sm">
          <thead className="bg-asphalt-light/60 text-left text-xs uppercase text-smoke">
            <tr>
              <th className="px-4 py-2">Ticket</th>
              <th className="px-4 py-2">Hora</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Retiro</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Pago</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-asphalt-light">
            {orders.map((o) => {
              const cancelado = o.status === "cancelled";
              return (
                <tr key={o.id} className={cn("hover:bg-asphalt/60", cancelado && "opacity-50 line-through")}>
                  <td className="px-4 py-2.5 font-bold text-flame">{ticketNo(o.ticket_number)}</td>
                  <td className="px-4 py-2.5 text-smoke">{formatTime(o.created_at)}</td>
                  <td className="px-4 py-2.5">{o.customer_name ?? "—"}</td>
                  <td className="px-4 py-2.5">{o.pickup_time ?? "Lo antes posible"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatPrice(o.total)}</td>
                  <td className="px-4 py-2.5">
                    {o.paid_at ? (
                      <span>{PAYMENT_LABELS[o.paid_method ?? o.payment_method]}</span>
                    ) : (
                      <span className="rounded bg-ketchup px-1.5 py-0.5 text-[11px] font-bold uppercase">
                        Sin cobrar · {PAYMENT_LABELS[o.payment_method]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-smoke">{STATUS_LABELS[o.status]}</td>
                  <td className="px-4 py-2.5 text-right">
                    {!o.paid_at && !cancelado && (
                      <button type="button" onClick={() => setCobrando(o)} className="btn-primary px-2.5 py-1.5 text-xs">
                        <Banknote className="h-3.5 w-3.5" /> Cobrar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-smoke">
                  Todavía no hay pedidos hoy.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {cobrando && <CobrarModal order={cobrando} onClose={() => setCobrando(null)} onPaid={() => void load()} />}
    </div>
  );
}

function Kpi({ label, value, sub, destacada, alerta }: { label: string; value: string; sub?: string; destacada?: boolean; alerta?: boolean }) {
  return (
    <div
      className={cn(
        "card p-4",
        destacada && "border-flame bg-flame/10",
        alerta && "border-ketchup",
      )}
    >
      <p className="text-xs font-bold uppercase text-smoke">{label}</p>
      <p className={cn("title mt-1 text-4xl", destacada ? "text-flame" : alerta ? "text-ketchup" : "text-bone")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-smoke">{sub}</p>}
    </div>
  );
}
