import { invoke } from "@tauri-apps/api/core";
import type {
  AppStatus,
  AvailablePrinters,
  Commissions,
  DaySummary,
  MenuSnapshot,
  NewOrder,
  Order,
  OrderStatus,
  PaymentMethod,
  CashMovement,
  CashMovementKind,
  CashStatus,
  PrinterConfig,
  ProductProfit,
} from "@/lib/types";

/**
 * Única puerta hacia el backend Rust. El frontend no habla con Supabase ni con la
 * impresora directamente: todo pasa por estos comandos.
 * (Los argumentos van en camelCase; Tauri los mapea a snake_case en Rust.)
 */

export type AdminTable =
  | "categories"
  | "products"
  | "promotions"
  | "option_groups"
  | "options"
  | "horarios"
  | "tienda"
  | "product_costs"
  | "option_costs";

/** Horario de un día de la semana (dia_semana: 0 = domingo). abre/cierra null = cerrado ese día. */
export interface HorarioRow {
  id: string;
  dia_semana: number;
  abre: string | null;
  cierra: string | null;
}

/** Estado de la tienda: cerrado_ahora corta los pedidos web; aviso se muestra en la carta. */
export interface TiendaRow {
  id: string;
  cerrado_ahora: boolean;
  aviso: string | null;
}

export interface StoreStateResponse {
  horarios: HorarioRow[];
  tienda: TiendaRow[];
}

export interface MenuResponse {
  snapshot: MenuSnapshot | null;
  source: "cloud" | "cache";
  error: string | null;
}

export const api = {
  // Estado y sesión
  appStatus: () => invoke<AppStatus>("app_status"),
  saveSupabaseConfig: (url: string, anonKey: string) => invoke<void>("save_supabase_config", { url, anonKey }),
  login: (email: string, password: string) => invoke<string>("login", { email, password }),
  logout: () => invoke<void>("logout"),
  syncNow: () => invoke<void>("sync_now"),

  // Menú
  getMenu: (refresh = false) => invoke<MenuResponse>("get_menu", { refresh }),
  getStoreState: () => invoke<StoreStateResponse>("get_store_state"),

  // Admin (escribe en Supabase → la landing se entera por Realtime)
  adminInsert: <T>(table: AdminTable, row: Partial<T>) => invoke<T>("admin_insert", { table, row }),
  adminUpdate: <T>(table: AdminTable, id: string, patch: Partial<T>) => invoke<T>("admin_update", { table, id, patch }),
  adminDelete: (table: AdminTable, id: string) => invoke<void>("admin_delete", { table, id }),
  adminSetProductGroups: (productId: string, groupIds: string[]) =>
    invoke<void>("admin_set_product_groups", { productId, groupIds }),
  adminAdjustPrices: (percent: number, categoryId: string | null, roundTo: number) =>
    invoke<number>("admin_adjust_prices", { percent, categoryId, roundTo }),

  // Pedidos (SQLite local, se sincronizan solos)
  createOrder: (input: NewOrder) => invoke<{ order: Order; print_error: string | null }>("create_order", { input }),
  listKitchenOrders: () => invoke<Order[]>("list_kitchen_orders"),
  listTodayOrders: (limit = 30) => invoke<Order[]>("list_today_orders", { limit }),
  daySummary: () => invoke<DaySummary>("day_summary"),
  dayProducts: () => invoke<ProductProfit[]>("day_products"),
  getCommissions: () => invoke<Commissions>("get_commissions"),
  saveCommissions: (input: Commissions) => invoke<Commissions>("save_commissions", { input }),
  cashStatus: () => invoke<CashStatus>("cash_status"),
  cashOpen: (openingCash: number) => invoke<CashStatus>("cash_open", { openingCash }),
  cashClose: (closingCash: number) => invoke<CashStatus>("cash_close", { closingCash }),
  cashAddMovement: (kind: CashMovementKind, amount: number, description: string | null) =>
    invoke<CashStatus>("cash_add_movement", { kind, amount, description }),
  cashSessionMovements: (sessionId: string) => invoke<CashMovement[]>("cash_session_movements", { sessionId }),
  updateOrderStatus: (id: string, status: OrderStatus) => invoke<void>("update_order_status", { id, status }),
  markOrderPaid: (id: string, method: PaymentMethod, amount: number) => invoke<Order>("mark_order_paid", { id, method, amount }),

  // Impresora
  listPrinters: () => invoke<AvailablePrinters>("list_printers"),
  getPrinterConfig: () => invoke<PrinterConfig>("get_printer_config"),
  savePrinterConfig: (config: PrinterConfig) => invoke<void>("save_printer_config", { config }),
  printTest: (config?: PrinterConfig) => invoke<void>("print_test", { config: config ?? null }),
  printRaw: (bytes: Uint8Array | number[]) => invoke<void>("print_raw", { bytes: Array.from(bytes) }),
  reprintOrder: (id: string, kind: "kitchen" | "receipt") => invoke<void>("reprint_order", { id, kind }),
};

/** Los errores de Rust llegan como string. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Error inesperado";
}
