import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CreditCard, History, Minus, Pencil, Plus, Printer, QrCode, Search, Trash2, Wallet, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import { normalize } from "@/lib/menu";
import type { MenuProduct, Order, OrderType, PaymentMethod } from "@/lib/types";
import { ORDER_TYPE_LABELS, PAYMENT_LABELS, cn, formatPrice, formatTime, ticketNo } from "@/lib/format";
import { OptionsModal, type CartLineDraft } from "@/components/OptionsModal";

type CartLine = CartLineDraft & { key: string };

const PAYMENTS: { id: PaymentMethod; icon: typeof Banknote }[] = [
  { id: "cash", icon: Banknote },
  { id: "card", icon: CreditCard },
  { id: "qr", icon: QrCode },
  { id: "transfer", icon: Wallet },
];

const lineKey = (l: CartLineDraft) => `${l.productId}|${l.modifications ?? ""}|${l.unitPrice}`;

/** Montos sugeridos para "Recibido" según los billetes que circulan. */
function cashSuggestions(total: number): number[] {
  const up = (step: number) => Math.ceil(total / step) * step;
  return Array.from(new Set([total, up(1000), up(5000), up(10000), up(20000)])).filter((v) => v >= total).slice(0, 5);
}

export default function PosScreen() {
  const { menu, menuSource, status, toast, refreshStatus } = useApp();

  // Catálogo
  const [activeCat, setActiveCat] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [customizing, setCustomizing] = useState<MenuProduct | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ticket
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const total = useMemo(() => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), [lines]);
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const cashReceived = cashInput ? Number(cashInput) : null;
  const change = payment === "cash" && cashReceived !== null ? cashReceived - total : null;
  const cashShort = payment === "cash" && cashReceived !== null && cashReceived < total;

  const products = useMemo(() => {
    const q = normalize(query.trim());
    const all = menu.flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })));
    return all.filter((p) => {
      if (q) return normalize(`${p.name} ${p.description ?? ""}`).includes(q);
      return activeCat === "all" || p.category_id === activeCat;
    });
  }, [menu, activeCat, query]);

  const addLine = useCallback((draft: CartLineDraft) => {
    const key = lineKey(draft);
    setLines((cur) => {
      const found = cur.find((l) => l.key === key);
      if (found) return cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + draft.quantity) } : l));
      return [...cur, { ...draft, key }];
    });
  }, []);

  const quickAdd = (p: MenuProduct) => {
    if (!p.available) return;
    // Si tiene opciones obligatorias, hay que abrir el selector
    if (p.optionGroups.some((g) => g.min_selections > 0)) return setCustomizing(p);
    addLine({ productId: p.id, name: p.name, unitPrice: p.price, quantity: 1, modifications: null });
  };

  const setQty = (key: string, q: number) =>
    setLines((cur) => (q <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, q) } : l))));

  const reset = () => {
    setLines([]);
    setCustomer("");
    setNotes("");
    setCashInput("");
    setPayment("cash");
    setOrderType("takeaway");
  };

  const checkout = useCallback(async () => {
    if (!lines.length || saving || cashShort) return;
    setSaving(true);
    try {
      const { order, print_error } = await api.createOrder({
        customer_name: customer.trim() || null,
        order_type: orderType,
        payment_method: payment,
        cash_received: payment === "cash" ? cashReceived : null,
        notes: notes.trim() || null,
        items: lines.map((l) => ({
          product_id: l.productId,
          product_name: l.name,
          unit_price: l.unitPrice,
          quantity: l.quantity,
          modifications: l.modifications,
        })),
      });
      const vuelto = order.cash_received ? order.cash_received - order.total : 0;
      toast(`Pedido ${ticketNo(order.ticket_number)} cobrado${vuelto > 0 ? ` · Vuelto ${formatPrice(vuelto)}` : ""}`);
      if (print_error) toast(`No se imprimió: ${print_error}`, "error");
      reset();
      void refreshStatus();
      searchRef.current?.focus();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  }, [lines, saving, cashShort, customer, orderType, payment, cashReceived, notes, toast, refreshStatus]);

  // Atajos: F9 cobrar · Ctrl+K buscar · Esc limpiar búsqueda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (customizing) return;
      if (e.key === "F9") {
        e.preventDefault();
        void checkout();
      } else if ((e.ctrlKey && e.key.toLowerCase() === "k") || e.key === "F6") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && query) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkout, customizing, query]);

  return (
    <div className="flex h-full">
      {/* ---------------- Catálogo ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-asphalt-light p-3">
          <div className="relative w-72 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-smoke" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && products.length === 1) {
                  quickAdd(products[0]);
                  setQuery("");
                }
              }}
              placeholder="Buscar (Ctrl+K)…"
              className="input pl-9"
              autoFocus
            />
          </div>
          <div className="scroll-thin flex gap-2 overflow-x-auto">
            {[{ id: "all", name: "Todo" }, ...menu].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveCat(c.id);
                  setQuery("");
                }}
                className={cn(
                  "shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  activeCat === c.id && !query ? "bg-flame text-azul-d" : "bg-asphalt text-bone/80 hover:bg-asphalt-light",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-3">
          {menu.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-smoke">
              <p className="title text-3xl text-bone">No hay carta cargada</p>
              <p>
                {status?.logged_in
                  ? "Revisá la conexión o tocá “Actualizar” en Menú."
                  : "Configurá Supabase e iniciá sesión en Configuración (F4). Después funciona sin internet."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {products.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "card group relative flex h-32 flex-col overflow-hidden transition-colors",
                    p.available ? "hover:border-flame" : "opacity-40",
                  )}
                >
                  <button
                    type="button"
                    disabled={!p.available}
                    onClick={() => quickAdd(p)}
                    className="flex flex-1 flex-col items-start p-3 text-left"
                  >
                    <span className="line-clamp-3 font-semibold leading-tight">{p.name}</span>
                    <span className="mt-auto title text-2xl text-flame">{formatPrice(p.price)}</span>
                    {!p.available && (
                      <span className="absolute right-2 top-2 rounded bg-ketchup px-1.5 py-0.5 text-[10px] font-bold uppercase">Agotado</span>
                    )}
                  </button>
                  {p.available && (
                    <button
                      type="button"
                      onClick={() => setCustomizing(p)}
                      title="Personalizar / notas"
                      className="absolute bottom-2 right-2 rounded-lg bg-carbon/80 p-2 text-smoke hover:bg-mustard hover:text-azul-d"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {menuSource === "cache" && menu.length > 0 && (
          <p className="border-t border-asphalt-light px-3 py-1.5 text-xs text-smoke">Usando la carta guardada en esta PC.</p>
        )}
      </section>

      {/* ---------------- Ticket ---------------- */}
      <aside className="flex w-[420px] shrink-0 flex-col border-l border-asphalt-light bg-asphalt">
        <div className="space-y-3 border-b border-asphalt-light p-4">
          <div className="flex items-center justify-between">
            <h2 className="title text-3xl">Ticket</h2>
            <div className="flex gap-1">
              <button type="button" onClick={() => setShowHistory(true)} className="btn-ghost px-3 py-2" title="Últimos pedidos / reimprimir">
                <History className="h-4 w-4" />
              </button>
              <button type="button" onClick={reset} disabled={!lines.length} className="btn-ghost px-3 py-2" title="Vaciar ticket">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-carbon p-1">
            {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={cn("rounded-lg py-2 text-xs font-semibold", orderType === t ? "bg-asphalt-lighter text-bone" : "text-smoke")}
              >
                {ORDER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <input value={customer} onChange={(e) => setCustomer(e.target.value.slice(0, 40))} placeholder="Nombre del cliente (opcional)" className="input" />
        </div>

        {/* Líneas */}
        <div className="scroll-thin flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <p className="p-8 text-center text-sm text-smoke">Tocá un producto para agregarlo.</p>
          ) : (
            <ul className="divide-y divide-asphalt-light">
              {lines.map((l) => (
                <li key={l.key} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex items-center rounded-lg border border-asphalt-lighter">
                    <button type="button" onClick={() => setQty(l.key, l.quantity - 1)} className="p-1.5" aria-label="Restar">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{l.quantity}</span>
                    <button type="button" onClick={() => setQty(l.key, l.quantity + 1)} className="p-1.5" aria-label="Sumar">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{l.name}</p>
                    {l.modifications && <p className="mt-0.5 text-xs text-mustard">{l.modifications}</p>}
                  </div>
                  <span className="text-sm font-semibold">{formatPrice(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cobro */}
        <div className="space-y-3 border-t border-asphalt-light p-4">
          <input value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 160))} placeholder="Nota para cocina (opcional)" className="input" />

          <div className="grid grid-cols-4 gap-2">
            {PAYMENTS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayment(id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold leading-tight",
                  payment === id ? "border-flame bg-flame/15 text-bone" : "border-asphalt-lighter text-smoke hover:text-bone",
                )}
              >
                <Icon className="h-5 w-5" />
                {PAYMENT_LABELS[id]}
              </button>
            ))}
          </div>

          {payment === "cash" && lines.length > 0 && (
            <div className="rounded-xl bg-carbon p-3">
              <div className="flex items-center gap-2">
                <label htmlFor="cash" className="text-xs font-semibold uppercase text-smoke">
                  Recibido
                </label>
                <input
                  id="cash"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder="0"
                  className="input py-1.5 text-right text-lg font-bold"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cashSuggestions(total).map((v) => (
                  <button key={v} type="button" onClick={() => setCashInput(String(v))} className="rounded-lg bg-asphalt-light px-2.5 py-1 text-xs font-semibold hover:bg-asphalt-lighter">
                    {v === total ? "Exacto" : formatPrice(v)}
                  </button>
                ))}
              </div>
              {change !== null && (
                <p className={cn("mt-2 flex justify-between text-lg font-bold", cashShort ? "text-ketchup" : "text-emerald-700")}>
                  <span>{cashShort ? "Falta" : "Vuelto"}</span>
                  <span>{formatPrice(Math.abs(change))}</span>
                </p>
              )}
            </div>
          )}

          <div className="flex items-end justify-between">
            <span className="text-sm text-smoke">{units} producto(s)</span>
            <span className="title text-5xl">{formatPrice(total)}</span>
          </div>

          <button type="button" onClick={() => void checkout()} disabled={!lines.length || saving || cashShort} className="btn-primary w-full py-4 text-lg">
            <Printer className="h-5 w-5" />
            {saving ? "Guardando…" : "Confirmar y cobrar (F9)"}
          </button>
        </div>
      </aside>

      <OptionsModal
        product={customizing}
        onClose={() => setCustomizing(null)}
        onConfirm={(line) => {
          addLine(line);
          setCustomizing(null);
        }}
      />

      {showHistory && <HistoryDrawer onClose={() => setShowHistory(false)} />}
    </div>
  );
}

/** Últimos pedidos del día con reimpresión. */
function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<{ orders: number; total: number } | null>(null);

  useEffect(() => {
    void api.listTodayOrders(40).then(setOrders).catch((e) => toast(errorText(e), "error"));
    void api.daySummary().then(setSummary).catch(() => undefined);
  }, [toast]);

  const reprint = async (id: string, kind: "kitchen" | "receipt") => {
    try {
      await api.reprintOrder(id, kind);
      toast("Enviado a la impresora");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-[480px] flex-col border-l border-asphalt-light bg-asphalt" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-asphalt-light p-4">
          <div>
            <h2 className="title text-3xl">Pedidos de hoy</h2>
            {summary && (
              <p className="text-sm text-smoke">
                {summary.orders} pedidos · {formatPrice(summary.total)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-asphalt-light" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </header>
        <ul className="scroll-thin flex-1 divide-y divide-asphalt-light overflow-y-auto">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-4 py-3">
              <span className="title w-14 text-2xl text-flame">{ticketNo(o.ticket_number)}</span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">
                  {formatPrice(o.total)} · {PAYMENT_LABELS[o.payment_method]}
                </p>
                <p className="truncate text-xs text-smoke">
                  {formatTime(o.created_at)} · {o.customer_name ?? "Sin nombre"} · {o.items.length} ítem(s)
                  {o.status === "cancelled" && " · CANCELADO"}
                  {!o.synced && " · sin subir"}
                </p>
              </div>
              <button type="button" onClick={() => void reprint(o.id, "kitchen")} className="btn-ghost px-2.5 py-1.5 text-xs">
                Comanda
              </button>
              <button type="button" onClick={() => void reprint(o.id, "receipt")} className="btn-ghost px-2.5 py-1.5 text-xs">
                Ticket
              </button>
            </li>
          ))}
          {orders.length === 0 && <li className="p-8 text-center text-sm text-smoke">Todavía no hay pedidos hoy.</li>}
        </ul>
      </div>
    </div>
  );
}
