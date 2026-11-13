import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import { cn, formatPrice } from "@/lib/format";
import type { CashMovementKind } from "@/lib/types";

export const CASH_KIND_LABELS: Record<CashMovementKind, string> = {
  ingreso: "Ingreso de dinero",
  ajuste_positivo: "Ajuste positivo (+)",
  retiro: "Retiro de caja",
  gasto: "Gastos varios",
  proveedor: "Pago a proveedor",
  personal: "Pago a personal",
  ajuste_negativo: "Ajuste negativo (−)",
};

const IN_KINDS: CashMovementKind[] = ["ingreso", "ajuste_positivo"];
const OUT_KINDS: CashMovementKind[] = ["retiro", "gasto", "proveedor", "personal", "ajuste_negativo"];

/** Registra un ingreso o egreso de efectivo mientras la caja está abierta. */
export function CashMovementModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [kind, setKind] = useState<CashMovementKind>("gasto");
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n) && n > 0;
  const isIn = IN_KINDS.includes(kind);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await api.cashAddMovement(kind, n, description.trim() || null);
      toast(`${CASH_KIND_LABELS[kind]}: ${formatPrice(n)}`);
      onDone();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const chip = (k: CashMovementKind) => (
    <button
      key={k}
      type="button"
      onClick={() => setKind(k)}
      className={cn(
        "rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition-colors",
        kind === k ? "border-flame bg-flame/15 text-bone" : "border-asphalt-lighter text-smoke hover:text-bone",
      )}
    >
      {CASH_KIND_LABELS[k]}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/70 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="title text-3xl">Registrar movimiento</h2>

        <p className="label mt-5">Entra a la caja</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">{IN_KINDS.map(chip)}</div>
        <p className="label mt-4">Sale de la caja</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">{OUT_KINDS.map(chip)}</div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <p className="label">Monto</p>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-smoke">$</span>
              <input
                autoFocus
                type="number"
                min={0}
                step={100}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="input pl-7 text-lg font-bold"
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <p className="label">Detalle {isIn ? "(opcional)" : "(recomendado)"}</p>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirm();
              }}
              className="input"
              placeholder={isIn ? "De dónde viene" : "Para qué fue"}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirm()} disabled={!valid || saving} className="btn-primary">
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}
