import type { MenuCategory, MenuOptionGroup, MenuSnapshot } from "@/lib/types";

/** Arma categorías → productos → grupos de opciones → opciones a partir de las tablas planas. */
export function buildMenu(s: MenuSnapshot, { onlyActive }: { onlyActive: boolean }): MenuCategory[] {
  const productCost = new Map<string, number>((s.product_costs ?? []).map((c): [string, number] => [c.id, Number(c.cost)]));
  const optionCost = new Map<string, number>((s.option_costs ?? []).map((c): [string, number] => [c.id, Number(c.cost)]));

  const groups = new Map<string, MenuOptionGroup>();
  for (const g of s.option_groups) groups.set(g.id, { ...g, options: [] });
  for (const o of s.options) {
    if (onlyActive && !o.available) continue;
    groups.get(o.group_id)?.options.push({ ...o, price: Number(o.price), cost: optionCost.get(o.id) ?? 0 });
  }

  const byProduct = new Map<string, MenuOptionGroup[]>();
  for (const link of [...s.product_option_groups].sort((a, b) => a.display_order - b.display_order)) {
    const g = groups.get(link.group_id);
    if (!g) continue;
    byProduct.set(link.product_id, [...(byProduct.get(link.product_id) ?? []), g]);
  }

  return s.categories
    .filter((c) => !onlyActive || c.active)
    .map((c) => ({
      ...c,
      products: s.products
        .filter((p) => p.category_id === c.id)
        .map((p) => ({ ...p, price: Number(p.price), cost: productCost.get(p.id) ?? 0, optionGroups: byProduct.get(p.id) ?? [] })),
    }))
    .filter((c) => !onlyActive || c.products.length > 0);
}

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
