import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Coins, Percent, Plus, RefreshCw, Save, Search, Tag, Trash2, Pencil, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useApp } from "@/lib/store";
import { buildMenu, normalize } from "@/lib/menu";
import type { CategoryRow, DiscountType, MenuProduct, OptionGroupRow, ProductRow, PromotionRow } from "@/lib/types";
import { cn, formatPrice } from "@/lib/format";

type Tab = "products" | "prices" | "promos" | "costs";

/**
 * Admin del menú en vivo. Todo cambio se escribe en Supabase (vía Rust) y la landing
 * lo recibe al instante por Realtime. Requiere internet y sesión iniciada.
 */
export default function MenuAdminScreen() {
  const { snapshot, status, reloadMenu, menuError } = useApp();
  const [tab, setTab] = useState<Tab>("products");
  const [refreshing, setRefreshing] = useState(false);

  const canEdit = Boolean(status?.logged_in && status.online);

  const refresh = async () => {
    setRefreshing(true);
    await reloadMenu(true);
    setRefreshing(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-asphalt-light px-4 py-3">
        <h1 className="title mr-4 text-4xl">Menú</h1>
        {(
          [
            ["products", "Productos", Tag],
            ["prices", "Ajuste de precios", Percent],
            ["promos", "Promociones", Plus],
            ["costs", "Costos", Coins],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn("btn", tab === id ? "bg-flame text-azul-d" : "text-smoke hover:bg-asphalt-light hover:text-bone")}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
        <button type="button" onClick={() => void refresh()} className="btn-ghost ml-auto" disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Actualizar
        </button>
      </div>

      {!canEdit && (
        <p className="bg-ketchup/20 px-4 py-2 text-sm">
          {status?.logged_in
            ? "Sin conexión: podés ver la carta pero los cambios se guardan cuando vuelva internet."
            : "Iniciá sesión en Configuración para editar la carta."}{" "}
          {menuError && <span className="text-smoke">({menuError})</span>}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {!snapshot ? (
          <p className="p-10 text-center text-smoke">Todavía no hay carta descargada.</p>
        ) : tab === "products" ? (
          <ProductsTab canEdit={canEdit} />
        ) : tab === "prices" ? (
          <PricesTab canEdit={canEdit} />
        ) : tab === "costs" ? (
          <CostsTab canEdit={canEdit} />
        ) : (
          <PromosTab canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}

/* =========================== Productos =========================== */

function ProductsTab({ canEdit }: { canEdit: boolean }) {
  const { snapshot, toast } = useApp();
  const [cat, setCat] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MenuProduct | "new" | null>(null);

  const categories = useMemo(() => (snapshot ? buildMenu(snapshot, { onlyActive: false }) : []), [snapshot]);
  const products = useMemo(() => {
    const q = normalize(query);
    return categories
      .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
      .filter((p) => (cat === "all" || p.category_id === cat) && (!q || normalize(p.name).includes(q)));
  }, [categories, cat, query]);

  const toggleAvailable = async (p: ProductRow) => {
    try {
      await api.adminUpdate<ProductRow>("products", p.id, { available: !p.available });
      toast(`${p.name}: ${p.available ? "AGOTADO" : "disponible"}`, p.available ? "info" : "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const remove = async (p: ProductRow) => {
    if (!window.confirm(`¿Borrar "${p.name}"? Si solo no hay stock, mejor marcalo como Agotado.`)) return;
    try {
      await api.adminDelete("products", p.id);
      toast("Producto borrado", "info");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="flex h-full">
      <aside className="scroll-thin w-56 shrink-0 space-y-1 overflow-y-auto border-r border-asphalt-light p-3">
        {[{ id: "all", name: "Todas", active: true, products: categories.flatMap((c) => c.products) }, ...categories].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className={cn(
              "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold",
              cat === c.id ? "bg-asphalt-lighter text-bone" : "text-smoke hover:bg-asphalt-light",
              !c.active && "line-through opacity-60",
            )}
          >
            {c.name}
            <span className="text-xs opacity-70">{c.products.length}</span>
          </button>
        ))}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 p-3">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-smoke" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto…" className="input pl-9" />
          </div>
          <button type="button" onClick={() => setEditing("new")} disabled={!canEdit} className="btn-primary ml-auto">
            <Plus className="h-4 w-4" /> Nuevo producto
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-carbon text-left text-xs uppercase tracking-wider text-smoke">
              <tr>
                <th className="py-2 pl-3">Producto</th>
                <th className="py-2">Categoría</th>
                <th className="w-40 py-2">Precio</th>
                <th className="w-32 py-2 text-center">Estado</th>
                <th className="w-24 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-asphalt-light">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-asphalt/60">
                  <td className="py-2.5 pl-3">
                    <p className="font-semibold">{p.name}</p>
                    {p.optionGroups.length > 0 && <p className="text-xs text-smoke">{p.optionGroups.map((g) => g.name).join(", ")}</p>}
                  </td>
                  <td className="text-smoke">{p.categoryName}</td>
                  <td>
                    <PriceCell product={p} canEdit={canEdit} />
                  </td>
                  <td className="text-center">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => void toggleAvailable(p)}
                      className={cn(
                        "w-28 rounded-full px-3 py-1.5 text-xs font-bold uppercase transition-colors disabled:opacity-50",
                        p.available ? "bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30" : "bg-ketchup text-papel hover:bg-ketchup/80",
                      )}
                    >
                      {p.available ? "Disponible" : "Agotado"}
                    </button>
                  </td>
                  <td className="text-right">
                    <button type="button" onClick={() => setEditing(p)} disabled={!canEdit} className="rounded-lg p-2 text-smoke hover:bg-asphalt-light hover:text-bone disabled:opacity-40" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void remove(p)} disabled={!canEdit} className="rounded-lg p-2 text-smoke hover:bg-ketchup/20 hover:text-ketchup disabled:opacity-40" title="Borrar">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && snapshot && (
        <ProductForm
          product={editing === "new" ? null : editing}
          categories={snapshot.categories}
          groups={snapshot.option_groups}
          defaultCategory={cat !== "all" ? cat : snapshot.categories[0]?.id ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Precio editable en la tabla: Enter o salir del campo guarda. */
function PriceCell({ product, canEdit }: { product: ProductRow; canEdit: boolean }) {
  const { toast } = useApp();
  const [value, setValue] = useState(String(product.price));
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(String(product.price)), [product.price]);

  const save = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return setValue(String(product.price));
    if (n === product.price) return;
    setSaving(true);
    try {
      await api.adminUpdate<ProductRow>("products", product.id, { price: n });
      toast(`${product.name}: ${formatPrice(n)}`);
    } catch (e) {
      toast(errorText(e), "error");
      setValue(String(product.price));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-smoke">$</span>
      <input
        type="number"
        min={0}
        step={100}
        value={value}
        disabled={!canEdit || saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setValue(String(product.price));
        }}
        className={cn("input py-1.5 pl-7 font-semibold", Number(value) !== product.price && "border-mustard")}
      />
    </div>
  );
}

function ProductForm({
  product,
  categories,
  groups,
  defaultCategory,
  onClose,
}: {
  product: MenuProduct | null;
  categories: CategoryRow[];
  groups: OptionGroupRow[];
  defaultCategory: string | null;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: product ? String(product.price) : "",
    category_id: product?.category_id ?? defaultCategory ?? "",
    image_url: product?.image_url ?? "",
    display_order: String(product?.display_order ?? 0),
    available: product?.available ?? true,
    featured: product?.featured ?? false,
  });
  const [groupIds, setGroupIds] = useState<string[]>(product?.optionGroups.map((g) => g.id) ?? []);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim().length > 1 && Number(form.price) >= 0 && form.price !== "";

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const row: Partial<ProductRow> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Number(form.price),
      category_id: form.category_id || null,
      image_url: form.image_url.trim() || null,
      display_order: Number(form.display_order) || 0,
      available: form.available,
      featured: form.featured,
    };
    try {
      const saved = product
        ? await api.adminUpdate<ProductRow>("products", product.id, row)
        : await api.adminInsert<ProductRow>("products", row);
      const before = (product?.optionGroups.map((g) => g.id) ?? []).join(",");
      if (groupIds.join(",") !== before) await api.adminSetProductGroups(saved.id, groupIds);
      toast(product ? "Producto actualizado" : "Producto creado");
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={product ? "Editar producto" : "Nuevo producto"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Nombre</label>
          <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </div>
        <div className="col-span-2">
          <label className="label">Descripción (se ve en la web)</label>
          <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className="label">Precio</label>
          <input className="input" type="number" min={0} step={100} value={form.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div>
          <label className="label">Categoría</label>
          <select className="input" value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">URL de la foto</label>
          <input className="input" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…supabase.co/storage/…" />
        </div>
        <div>
          <label className="label">Orden en la carta</label>
          <input className="input" type="number" value={form.display_order} onChange={(e) => set("display_order", e.target.value)} />
        </div>
        <div className="flex items-end gap-4 pb-2">
          <Toggle label="Disponible" on={form.available} onChange={(v) => set("available", v)} />
          <Toggle label="Destacado" on={form.featured} onChange={(v) => set("featured", v)} />
        </div>
        <div className="col-span-2">
          <label className="label">Opciones que ofrece</label>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupIds((cur) => (on ? cur.filter((x) => x !== g.id) : [...cur, g.id]))}
                  className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", on ? "border-flame bg-flame/15" : "border-asphalt-lighter text-smoke")}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
        <button type="button" onClick={() => void save()} disabled={!valid || saving} className="btn-primary">
          <Save className="h-4 w-4" /> {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

/* =========================== Costos =========================== */

/**
 * Costo de cada producto y de cada agregado. Sirve para calcular la ganancia del día.
 * Los costos no se publican en la web: se guardan en una tabla que solo ve el personal.
 */
function CostsTab({ canEdit }: { canEdit: boolean }) {
  const { snapshot, toast } = useApp();
  const [query, setQuery] = useState("");

  const productCost = useMemo(
    () => new Map((snapshot?.product_costs ?? []).map((c) => [c.id, Number(c.cost)] as const)),
    [snapshot],
  );
  const optionCost = useMemo(
    () => new Map((snapshot?.option_costs ?? []).map((c) => [c.id, Number(c.cost)] as const)),
    [snapshot],
  );

  const q = normalize(query.trim());
  const products = useMemo(() => {
    if (!snapshot) return [];
    const catName = new Map(snapshot.categories.map((c) => [c.id, c.name] as const));
    return snapshot.products
      .filter((p) => snapshot.categories.find((c) => c.id === p.category_id)?.active)
      .filter((p) => !q || normalize(p.name).includes(q))
      .map((p) => ({ ...p, categoryName: catName.get(p.category_id ?? "") ?? "" }));
  }, [snapshot, q]);

  const options = useMemo(() => {
    if (!snapshot) return [];
    const groupName = new Map(snapshot.option_groups.map((g) => [g.id, g.name] as const));
    return snapshot.options
      .filter((o) => !q || normalize(`${o.name} ${groupName.get(o.group_id) ?? ""}`).includes(q))
      .map((o) => ({ ...o, groupName: groupName.get(o.group_id) ?? "" }));
  }, [snapshot, q]);

  const saveCost = async (table: "product_costs" | "option_costs", id: string, name: string, n: number) => {
    try {
      await api.adminUpdate<{ cost: number }>(table, id, { cost: n });
      toast(`Costo de ${name}: ${formatPrice(n)}`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  if (!snapshot) return null;

  return (
    <div className="scroll-thin h-full overflow-y-auto p-5">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-smoke" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto u opción…" className="input pl-9" />
        </div>
        <p className="text-sm text-smoke">
          Cargá lo que te cuesta cada cosa. La ganancia del día usa estos números (Día → Ganancia neta).
        </p>
      </div>

      <h2 className="title mb-2 text-2xl">Productos</h2>
      <section className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-asphalt-light/60 text-left text-xs uppercase text-smoke">
            <tr>
              <th className="py-2 pl-3">Producto</th>
              <th className="py-2">Categoría</th>
              <th className="w-36 py-2">Precio</th>
              <th className="w-40 py-2">Costo</th>
              <th className="w-24 py-2 text-right pr-3">Margen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-asphalt-light">
            {products.map((p) => {
              const cost = productCost.get(p.id) ?? 0;
              const price = Number(p.price);
              return (
                <tr key={p.id} className="hover:bg-asphalt/60">
                  <td className="py-2 pl-3 font-semibold">{p.name}</td>
                  <td className="text-smoke">{p.categoryName}</td>
                  <td>{formatPrice(price)}</td>
                  <td>
                    <CostCell value={cost} canEdit={canEdit} onSave={(n) => saveCost("product_costs", p.id, p.name, n)} />
                  </td>
                  <td className="pr-3 text-right text-smoke">{price > 0 ? `${Math.round(((price - cost) / price) * 100)}%` : "—"}</td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-smoke">
                  No hay productos para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <h2 className="title mb-2 text-2xl">Agregados y opciones</h2>
      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-asphalt-light/60 text-left text-xs uppercase text-smoke">
            <tr>
              <th className="py-2 pl-3">Opción</th>
              <th className="py-2">Grupo</th>
              <th className="w-36 py-2">Precio</th>
              <th className="w-40 py-2">Costo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-asphalt-light">
            {options.map((o) => (
              <tr key={o.id} className="hover:bg-asphalt/60">
                <td className="py-2 pl-3 font-semibold">{o.name}</td>
                <td className="text-smoke">{o.groupName}</td>
                <td>{formatPrice(Number(o.price))}</td>
                <td>
                  <CostCell
                    value={optionCost.get(o.id) ?? 0}
                    canEdit={canEdit}
                    onSave={(n) => saveCost("option_costs", o.id, o.name, n)}
                  />
                </td>
              </tr>
            ))}
            {options.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-smoke">
                  No hay opciones para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Costo editable: se guarda al salir del campo o con Enter. */
function CostCell({ value, canEdit, onSave }: { value: number; canEdit: boolean; onSave: (n: number) => Promise<void> }) {
  const [text, setText] = useState(String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(String(value)), [value]);

  const save = async () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n < 0) return setText(String(value));
    if (n === value) return;
    setSaving(true);
    try {
      await onSave(n);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative w-32">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-smoke">$</span>
      <input
        type="number"
        min={0}
        step={50}
        value={text}
        disabled={!canEdit || saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(String(value));
        }}
        className={cn("input py-1.5 pl-7 font-semibold", Number(text) !== value && "border-mustard")}
      />
    </div>
  );
}

/* =========================== Ajuste de precios =========================== */

function PricesTab({ canEdit }: { canEdit: boolean }) {
  const { snapshot, toast } = useApp();
  const [percent, setPercent] = useState("10");
  const [category, setCategory] = useState<string>("");
  const [roundTo, setRoundTo] = useState(100);
  const [saving, setSaving] = useState(false);

  const pct = Number(percent);
  const preview = useMemo(() => {
    if (!snapshot || !Number.isFinite(pct)) return [];
    return snapshot.products
      .filter((p) => !category || p.category_id === category)
      .map((p) => ({
        id: p.id,
        name: p.name,
        before: Number(p.price),
        after: Math.max(0, Math.round((Number(p.price) * (1 + pct / 100)) / roundTo) * roundTo),
      }));
  }, [snapshot, category, pct, roundTo]);

  const apply = async () => {
    if (!window.confirm(`¿Aplicar ${pct > 0 ? "+" : ""}${pct}% a ${preview.length} productos? Se ve al instante en la web.`)) return;
    setSaving(true);
    try {
      const n = await api.adminAdjustPrices(pct, category || null, roundTo);
      toast(`${n} precios actualizados`);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full gap-6 p-6">
      <div className="card h-fit w-96 shrink-0 space-y-4 p-5">
        <h2 className="title text-3xl">Ajuste masivo</h2>
        <p className="text-sm text-smoke">Ideal para actualizar por inflación. Se aplica sobre el precio base (los extras no cambian).</p>
        <div>
          <label className="label">Porcentaje</label>
          <div className="flex gap-2">
            <input className="input text-lg font-bold" type="number" step={0.5} value={percent} onChange={(e) => setPercent(e.target.value)} />
            {[5, 10, 15].map((v) => (
              <button key={v} type="button" onClick={() => setPercent(String(v))} className="btn-ghost px-3">
                +{v}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Aplicar a</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Toda la carta</option>
            {snapshot?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Redondear a</label>
          <div className="grid grid-cols-4 gap-2">
            {[10, 50, 100, 500].map((r) => (
              <button key={r} type="button" onClick={() => setRoundTo(r)} className={cn("btn", roundTo === r ? "bg-flame text-azul-d" : "bg-asphalt-light")}>
                ${r}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => void apply()} disabled={!canEdit || saving || !pct || !preview.length} className="btn-primary w-full py-3">
          {saving ? "Aplicando…" : `Aplicar a ${preview.length} productos`}
        </button>
      </div>

      <div className="card scroll-thin min-w-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-asphalt text-left text-xs uppercase tracking-wider text-smoke">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="py-3 text-right">Actual</th>
              <th className="px-4 py-3 text-right">Nuevo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-asphalt-light">
            {preview.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.name}</td>
                <td className="py-2 text-right text-smoke">{formatPrice(p.before)}</td>
                <td className={cn("px-4 py-2 text-right font-bold", p.after > p.before ? "text-flame" : "text-emerald-700")}>{formatPrice(p.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================== Promociones =========================== */

const DISCOUNT_LABELS: Record<DiscountType, string> = { percent: "% de descuento", fixed: "$ de descuento", free_item: "Producto de regalo" };

// <input type="datetime-local"> trabaja en hora local, sin zona
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function PromosTab({ canEdit }: { canEdit: boolean }) {
  const { snapshot, toast } = useApp();
  const [editing, setEditing] = useState<PromotionRow | "new" | null>(null);
  const promos = snapshot?.promotions ?? [];

  const toggle = async (p: PromotionRow) => {
    try {
      await api.adminUpdate<PromotionRow>("promotions", p.id, { active: !p.active });
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const remove = async (p: PromotionRow) => {
    if (!window.confirm(`¿Borrar la promo "${p.title}"?`)) return;
    try {
      await api.adminDelete("promotions", p.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-smoke">Las promos activas y vigentes se pueden mostrar en la web.</p>
        <button type="button" onClick={() => setEditing("new")} disabled={!canEdit} className="btn-primary">
          <Plus className="h-4 w-4" /> Nueva promo
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {promos.map((p) => (
          <article key={p.id} className={cn("card space-y-2 p-4", !p.active && "opacity-50")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="title text-2xl">{p.title}</h3>
              <button type="button" disabled={!canEdit} onClick={() => void toggle(p)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase", p.active ? "bg-emerald-500/20 text-emerald-700" : "bg-asphalt-lighter text-smoke")}>
                {p.active ? "Activa" : "Pausada"}
              </button>
            </div>
            {p.description && <p className="text-sm text-smoke">{p.description}</p>}
            <p className="text-sm">
              {p.discount_type ? DISCOUNT_LABELS[p.discount_type] : "Sin descuento"}
              {p.discount_value != null && p.discount_type !== "free_item" && `: ${p.discount_type === "percent" ? `${p.discount_value}%` : formatPrice(p.discount_value)}`}
            </p>
            <p className="text-xs text-smoke">
              {p.valid_from ? new Date(p.valid_from).toLocaleDateString("es-AR") : "Desde siempre"} →{" "}
              {p.valid_until ? new Date(p.valid_until).toLocaleDateString("es-AR") : "sin vencimiento"}
            </p>
            <div className="flex justify-end gap-1 pt-1">
              <button type="button" disabled={!canEdit} onClick={() => setEditing(p)} className="rounded-lg p-2 text-smoke hover:bg-asphalt-light">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" disabled={!canEdit} onClick={() => void remove(p)} className="rounded-lg p-2 text-smoke hover:bg-ketchup/20">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </article>
        ))}
        {promos.length === 0 && <p className="text-smoke">No hay promociones cargadas.</p>}
      </div>
      {editing && <PromoForm promo={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PromoForm({ promo, onClose }: { promo: PromotionRow | null; onClose: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    title: promo?.title ?? "",
    description: promo?.description ?? "",
    discount_type: (promo?.discount_type ?? "percent") as DiscountType,
    discount_value: promo?.discount_value != null ? String(promo.discount_value) : "",
    valid_from: toLocalInput(promo?.valid_from ?? null),
    valid_until: toLocalInput(promo?.valid_until ?? null),
    image_url: promo?.image_url ?? "",
    active: promo?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const row: Partial<PromotionRow> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: form.discount_type === "free_item" || form.discount_value === "" ? null : Number(form.discount_value),
      valid_from: fromLocalInput(form.valid_from),
      valid_until: fromLocalInput(form.valid_until),
      image_url: form.image_url.trim() || null,
      active: form.active,
    };
    try {
      if (promo) await api.adminUpdate<PromotionRow>("promotions", promo.id, row);
      else await api.adminInsert<PromotionRow>("promotions", row);
      toast("Promo guardada");
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={promo ? "Editar promo" : "Nueva promo"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Título</label>
          <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Promo del finde" autoFocus />
        </div>
        <div className="col-span-2">
          <label className="label">Descripción</label>
          <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={form.discount_type} onChange={(e) => set("discount_type", e.target.value as DiscountType)}>
            {(Object.keys(DISCOUNT_LABELS) as DiscountType[]).map((k) => (
              <option key={k} value={k}>
                {DISCOUNT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Valor</label>
          <input className="input" type="number" min={0} disabled={form.discount_type === "free_item"} value={form.discount_value} onChange={(e) => set("discount_value", e.target.value)} />
        </div>
        <div>
          <label className="label">Desde</label>
          <input className="input" type="datetime-local" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input className="input" type="datetime-local" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">URL de imagen (opcional)</label>
          <input className="input" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} />
        </div>
        <Toggle label="Activa" on={form.active} onChange={(v) => set("active", v)} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || form.title.trim().length < 2} className="btn-primary">
          <Save className="h-4 w-4" /> Guardar
        </button>
      </div>
    </Modal>
  );
}

/* =========================== UI chica =========================== */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="card scroll-thin max-h-full w-full max-w-xl overflow-y-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="title text-3xl">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-asphalt-light" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn("relative h-6 w-11 rounded-full transition-colors", on ? "bg-flame" : "bg-asphalt-lighter")}
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-papel transition-all", on ? "left-[22px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}
