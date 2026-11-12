import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import type { MenuOptionGroup, MenuProduct } from "@/lib/types";
import { cn, formatPrice } from "@/lib/format";

/** Modificaciones rápidas más pedidas (van a la comanda en MAYÚSCULAS y resaltadas). */
const QUICK_NOTES = ["Sin cebolla", "Sin tomate", "Sin cheddar", "Sin salsa", "Sin pickles", "Bien cocida", "Cortada al medio", "Aparte la salsa"];

export type CartLineDraft = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifications: string | null;
};

type Props = {
  product: MenuProduct | null;
  onClose: () => void;
  onConfirm: (line: CartLineDraft) => void;
};

function hint(g: MenuOptionGroup) {
  if (g.max_selections === 1) return g.min_selections ? "Elegí 1 · obligatorio" : "Elegí 1";
  return g.min_selections ? `Elegí ${g.min_selections} a ${g.max_selections}` : `Hasta ${g.max_selections}`;
}

export function OptionsModal({ product, onClose, onConfirm }: Props) {
  if (!product) return null;
  return <Body key={product.id} product={product} onClose={onClose} onConfirm={onConfirm} />;
}

function Body({ product, onClose, onConfirm }: { product: MenuProduct } & Omit<Props, "product">) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quick, setQuick] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  const missing = product.optionGroups.filter((g) => (selected[g.id]?.length ?? 0) < g.min_selections);

  const chosen = useMemo(
    () =>
      product.optionGroups.map((g) => ({
        group: g,
        options: g.options.filter((o) => (selected[g.id] ?? []).includes(o.id)),
      })),
    [product, selected],
  );
  const unitPrice = product.price + chosen.reduce((s, c) => s + c.options.reduce((a, o) => a + o.price, 0), 0);

  const confirm = () => {
    if (missing.length) return;
    const parts: string[] = [];
    for (const c of chosen) {
      if (c.options.length) parts.push(`${c.group.name}: ${c.options.map((o) => o.name).join(", ")}`);
    }
    for (const q of quick) parts.push(q.toUpperCase());
    if (note.trim()) parts.push(note.trim().toUpperCase());
    onConfirm({
      productId: product.id,
      name: product.name,
      unitPrice,
      quantity: qty,
      modifications: parts.length ? parts.join(" · ") : null,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (g: MenuOptionGroup, id: string) =>
    setSelected((prev) => {
      const cur = prev[g.id] ?? [];
      if (cur.includes(id)) return { ...prev, [g.id]: cur.filter((x) => x !== id) };
      if (g.max_selections === 1) return { ...prev, [g.id]: [id] };
      if (cur.length >= g.max_selections) return prev;
      return { ...prev, [g.id]: [...cur, id] };
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="card flex max-h-full w-full max-w-2xl flex-col overflow-hidden shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-asphalt-light p-5">
          <div>
            <h2 className="title text-4xl">{product.name}</h2>
            <p className="mt-1 text-flame">{formatPrice(product.price)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-smoke hover:bg-asphalt-light" aria-label="Cerrar">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
          {product.optionGroups.map((g) => {
            const sel = selected[g.id] ?? [];
            return (
              <section key={g.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="title text-2xl">{g.name}</h3>
                  <span className={cn("text-xs", missing.includes(g) ? "font-bold text-flame" : "text-smoke")}>{hint(g)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {g.options.map((o) => {
                    const on = sel.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(g, o.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors",
                          on ? "border-flame bg-flame/15" : "border-asphalt-lighter hover:border-bone/30",
                        )}
                      >
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border-2", on ? "border-flame bg-flame text-carbon" : "border-smoke")}>
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="flex-1">{o.name}</span>
                        {o.price > 0 && <span className="text-smoke">+{formatPrice(o.price)}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section>
            <h3 className="title mb-2 text-2xl">Modificaciones</h3>
            <div className="flex flex-wrap gap-2">
              {QUICK_NOTES.map((q) => {
                const on = quick.includes(q);
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuick((cur) => (on ? cur.filter((x) => x !== q) : [...cur, q]))}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                      on ? "border-mustard bg-mustard text-carbon" : "border-asphalt-lighter text-bone/80 hover:border-bone/30",
                    )}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 120))}
              rows={2}
              placeholder="Otra aclaración para la cocina…"
              className="input mt-3 resize-none"
            />
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t border-asphalt-light p-4">
          <div className="flex items-center rounded-xl border border-asphalt-lighter">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-3" aria-label="Restar">
              <Minus className="h-5 w-5" />
            </button>
            <span className="w-10 text-center text-xl font-bold">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} className="p-3" aria-label="Sumar">
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <button type="button" disabled={missing.length > 0} onClick={confirm} className="btn-primary flex-1 justify-between py-4 text-base">
            <span>Agregar al ticket (Enter)</span>
            <span className="title text-2xl">{formatPrice(unitPrice * qty)}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
