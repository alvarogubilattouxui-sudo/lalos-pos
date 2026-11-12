import { useEffect, useState } from "react";
import { Banknote, CreditCard, QrCode, Wallet, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Order, PaymentMethod } from "@/lib/types";
import { PAYMENT_LABELS, cn, formatPrice, ticketNo } from "@/lib/format";

const METHODS: { id: PaymentMethod; icon: typeof Banknote }[] = [
  { id: "cash", icon: Banknote },
  { id: "transfer", icon: Wallet },
  { id: "qr", icon: QrCode },
  { id: "card", icon: CreditCard },
];

/**
 * Cobro de un pedido que todavía no se pagó (típicamente un pedido web que se retira y se paga en el local).
 * Elige el medio con el que se cobró y el importe. Se guarda solo en esta caja.
 */
export function CobrarModal({ order, onClose, onPaid }: { order: Order; onClose: () => void; onPaid?: (o: Order) => void }) {
  const { toast } = useApp();
  const [method, setMethod] = useState<PaymentMethod>(order.payment_method);
  const [amount, setAmount] = useState(String(order.total));
  const [saving, setSaving] = useState(false);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await api.markOrderPaid(order.id, method, n);
      toast(`Pedido ${ticketNo(order.ticket_number)} cobrado · ${PAYMENT_LABELS[method]} ${formatPrice(n)}`);
      onPaid?.(updated);
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && !saving) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="card w-full max-w-md overflow-hidden shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-asphalt-light p-5">
          <div>
            <h2 className="title text-4xl">Cobrar {ticketNo(order.ticket_number)}</h2>
            <p className="mt-1 text-sm text-smoke">
              {order.customer_name ?? "Sin nombre"} · Total {formatPrice(order.total)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-smoke hover:bg-asphalt-light" aria-label="Cerrar">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          <div>
            <p className="label">¿Cómo pagó?</p>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMethod(id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold",
                    method === id ? "border-flame bg-flame/15 text-bone" : "border-asphalt-lighter text-smoke hover:text-bone",
                  )}
                >
                  <Icon className="h-5 w-5" /> {PAYMENT_LABELS[id]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="cobro-importe" className="label">
              Importe cobrado
            </label>
            <div className="flex gap-2">
              <input
                id="cobro-importe"
                className="input text-lg font-bold"
                type="number"
                min={0}
                step={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              <button type="button" onClick={() => setAmount(String(order.total))} className="btn-ghost whitespace-nowrap">
                Total
              </button>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-asphalt-light p-4">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void save()} disabled={!valid || saving} className="btn-primary">
            {saving ? "Guardando…" : "Confirmar cobro (Enter)"}
          </button>
        </footer>
      </div>
    </div>
  );
}
