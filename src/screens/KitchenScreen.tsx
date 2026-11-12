import { useCallback, useEffect, useState } from "react";
import { Ban, Check, ChefHat, Clock, HandPlatter, Printer } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Order, OrderStatus } from "@/lib/types";
import { ORDER_TYPE_LABELS, STATUS_LABELS, cn, formatTime, minutesSince, ticketNo } from "@/lib/format";

/** Pitido corto para que cocina se entere de un pedido web aunque esté de espaldas a la pantalla. */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // sin audio: no pasa nada, el pedido igual aparece en pantalla
  }
}

/** Siguiente paso de cada estado en la cocina. */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; icon: typeof Check }>> = {
  pending: { to: "preparing", label: "Empezar", icon: ChefHat },
  preparing: { to: "ready", label: "Listo", icon: Check },
  ready: { to: "delivered", label: "Entregado", icon: HandPlatter },
};

const COLUMNS: { status: OrderStatus; title: string; accent: string }[] = [
  { status: "pending", title: "Nuevos", accent: "text-mustard" },
  { status: "preparing", title: "En preparación", accent: "text-flame" },
  { status: "ready", title: "Listos para entregar", accent: "text-emerald-400" },
];

/** Umbrales de demora (minutos) para pintar las tarjetas. */
const WARN_AT = 10;
const LATE_AT = 15;

export default function KitchenScreen() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setOrders(await api.listKitchenOrders());
    } catch (e) {
      toast(errorText(e), "error");
    }
  }, [toast]);

  // Pedido que llegó desde la web: se refresca, suena y avisa si la comanda no salió impresa
  useEffect(() => {
    const unlisten = listen<{ count: number; tickets: number[]; print_error: string | null }>("web-order", (e) => {
      void load();
      beep();
      toast(`Pedido web ${e.payload.tickets.map(ticketNo).join(", ")} ${e.payload.print_error ? "" : "· comanda impresa"}`.trim(), "ok");
      if (e.payload.print_error) toast(`No se pudo imprimir la comanda: ${e.payload.print_error}`, "error");
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [load, toast]);

  useEffect(() => {
    void load();
    // SQLite local: consultar seguido es barato
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const move = async (o: Order, to: OrderStatus) => {
    // Optimista: la cocina no espera
    setOrders((cur) => (to === "delivered" || to === "cancelled" ? cur.filter((x) => x.id !== o.id) : cur.map((x) => (x.id === o.id ? { ...x, status: to } : x))));
    try {
      await api.updateOrderStatus(o.id, to);
    } catch (e) {
      toast(errorText(e), "error");
      void load();
    }
  };

  const cancel = (o: Order) => {
    if (window.confirm(`¿Cancelar el pedido ${ticketNo(o.ticket_number)}?`)) void move(o, "cancelled");
  };

  const reprint = async (o: Order) => {
    try {
      await api.reprintOrder(o.id, "kitchen");
      toast(`Comanda ${ticketNo(o.ticket_number)} reimpresa`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="grid h-full grid-cols-3 gap-px bg-asphalt-light">
      {COLUMNS.map((col) => {
        const list = orders.filter((o) => o.status === col.status); // ya vienen ordenados por hora (más viejo primero)
        return (
          <section key={col.status} className="flex min-h-0 flex-col bg-carbon">
            <header className="flex items-center justify-between px-4 py-3">
              <h2 className={cn("title text-3xl", col.accent)}>{col.title}</h2>
              <span className="rounded-full bg-asphalt px-3 py-1 text-sm font-bold">{list.length}</span>
            </header>
            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 pb-3">
              {list.map((o) => {
                const mins = minutesSince(o.created_at, now);
                const late = col.status !== "ready" && mins >= LATE_AT;
                const warn = col.status !== "ready" && mins >= WARN_AT && !late;
                const next = NEXT[o.status];
                return (
                  <article
                    key={o.id}
                    className={cn(
                      "card overflow-hidden border-2",
                      late ? "border-ketchup" : warn ? "border-mustard/70" : "border-asphalt-light",
                    )}
                  >
                    <div className={cn("flex items-center justify-between px-4 py-2", late ? "bg-ketchup/25" : "bg-asphalt-light")}>
                      <span className="title text-4xl">{ticketNo(o.ticket_number)}</span>
                      <div className="text-right text-xs">
                        <p className="font-bold uppercase">{ORDER_TYPE_LABELS[o.order_type]}</p>
                        <p className={cn("flex items-center justify-end gap-1", late ? "font-bold text-[#ff8a7a]" : "text-smoke")}>
                          <Clock className="h-3 w-3" /> {formatTime(o.created_at)} · {mins} min
                        </p>
                      </div>
                    </div>
                    {o.customer_name && <p className="px-4 pt-2 text-sm font-semibold text-mustard">{o.customer_name}</p>}
                    <ul className="space-y-2 px-4 py-3">
                      {o.items.map((it) => (
                        <li key={it.id}>
                          <p className="text-lg font-bold leading-tight">
                            <span className="text-flame">{it.quantity}×</span> {it.product_name}
                          </p>
                          {it.modifications && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {it.modifications.split(" · ").map((m) => (
                                <span key={m} className="rounded bg-mustard px-1.5 py-0.5 text-xs font-bold text-carbon">
                                  {m}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="mx-4 mb-3 rounded-lg bg-ketchup/20 px-3 py-2 text-sm font-semibold">📝 {o.notes}</p>}
                    <footer className="flex gap-2 border-t border-asphalt-light p-2">
                      {next && (
                        <button type="button" onClick={() => void move(o, next.to)} className="btn-primary flex-1 py-3 text-base">
                          <next.icon className="h-5 w-5" /> {next.label}
                        </button>
                      )}
                      <button type="button" onClick={() => void reprint(o)} className="btn-ghost px-3" title="Reimprimir comanda">
                        <Printer className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => cancel(o)} className="btn-danger px-3" title="Cancelar pedido">
                        <Ban className="h-4 w-4" />
                      </button>
                    </footer>
                  </article>
                );
              })}
              {list.length === 0 && (
                <p className="py-10 text-center text-sm text-smoke">Nada en “{STATUS_LABELS[col.status]}”</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
