import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import { formatPrice } from "@/lib/format";

/** Pide cuánto efectivo hay al abrir la caja o cuánto se contó al cerrarla. */
export function CashModal({
  mode,
  onClose,
  onDone,
}: {
  mode: "open" | "close";
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useApp();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const isOpen = mode === "open";
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (isOpen) {
        await api.cashOpen(n);
        toast(`Caja abierta con ${formatPrice(n)} en efectivo`);
      } else {
        const s = await api.cashClose(n);
        const last = s.history[0];
        if (last && last.difference !== null) {
          const diff = last.difference;
          toast(
            diff === 0
              ? "Caja cerrada: cuadra"
              : `Caja cerrada: ${diff > 0 ? "sobran" : "faltan"} ${formatPrice(Math.abs(diff))}`,
            diff === 0 ? "ok" : "error",
          );
        }
      }
      onDone();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/70 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="title text-3xl">{isOpen ? "Abrir caja" : "Cerrar caja"}</h2>
        <p className="mt-2 text-sm text-smoke">
          {isOpen
            ? "¿Cuánta plata en efectivo hay en la caja al empezar el día?"
            : "¿Cuánta plata en efectivo contaste en la caja al cerrar?"}
        </p>
        <div className="relative mt-5">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-smoke">$</span>
          <input
            autoFocus
            type="number"
            min={0}
            step={100}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
            }}
            className="input pl-7 text-lg font-bold"
            placeholder="0"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirm()} disabled={!valid || saving} className="btn-primary">
            {isOpen ? "Abrir caja" : "Cerrar caja"}
          </button>
        </div>
      </div>
    </div>
  );
}
