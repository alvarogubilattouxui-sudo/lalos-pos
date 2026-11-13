/* ---------- Filas de Supabase (mismo esquema que la landing) ---------- */

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  active: boolean;
}

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  available: boolean;
  featured: boolean;
  display_order: number;
  updated_at?: string;
}

export interface OptionGroupRow {
  id: string;
  name: string;
  min_selections: number;
  max_selections: number;
  display_order: number;
}

export interface OptionRow {
  id: string;
  group_id: string;
  name: string;
  price: number;
  available: boolean;
  display_order: number;
}

export interface ProductOptionGroupRow {
  product_id: string;
  group_id: string;
  display_order: number;
}

/** Costo de un producto u opción (tabla privada: solo personal). El id es el del producto/opción. */
export interface CostRow {
  id: string;
  cost: number;
}

export type DiscountType = "percent" | "fixed" | "free_item";

export interface PromotionRow {
  id: string;
  title: string;
  description: string | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  valid_from: string | null;
  valid_until: string | null;
  image_url: string | null;
  active: boolean;
}

export interface MenuSnapshot {
  categories: CategoryRow[];
  products: ProductRow[];
  option_groups: OptionGroupRow[];
  options: OptionRow[];
  product_option_groups: ProductOptionGroupRow[];
  promotions: PromotionRow[];
  /** Opcionales: las copias guardadas antes de la versión con costos no los tienen. */
  product_costs?: CostRow[];
  option_costs?: CostRow[];
  fetched_at: string;
}

/* ---------- Menú armado para la UI ---------- */

export type MenuOption = OptionRow & { cost: number };
export type MenuOptionGroup = OptionGroupRow & { options: MenuOption[] };
export type MenuProduct = ProductRow & { optionGroups: MenuOptionGroup[]; cost: number };
export type MenuCategory = CategoryRow & { products: MenuProduct[] };

/* ---------- Pedidos (SQLite local) ---------- */

export type PaymentMethod = "cash" | "card" | "qr" | "transfer";
export type OrderType = "takeaway" | "local" | "delivery";
export type OrderStatus = "pending" | "preparing" | "ready" | "delivered" | "cancelled";

export interface OrderItem {
  id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  modifications: string | null;
  subtotal: number;
  unit_cost: number;
}

export interface Order {
  id: string;
  ticket_number: number;
  business_day: string;
  customer_name: string | null;
  order_type: OrderType;
  status: OrderStatus;
  total: number;
  /** Medio elegido al pedir (web) o con el que se cobró (caja). */
  payment_method: PaymentMethod;
  cash_received: number | null;
  notes: string | null;
  /** Horario de retiro elegido en la web ("HH:MM"). null = lo antes posible. */
  pickup_time: string | null;
  /** null = todavía sin cobrar. */
  paid_at: string | null;
  paid_method: PaymentMethod | null;
  paid_amount: number | null;
  created_at: string;
  updated_at: string;
  synced: boolean;
  sync_error: string | null;
  items: OrderItem[];
}

export interface NewOrder {
  customer_name: string | null;
  order_type: OrderType;
  payment_method: PaymentMethod;
  cash_received: number | null;
  notes: string | null;
  items: {
    product_id: string | null;
    product_name: string;
    unit_price: number;
    quantity: number;
    modifications: string | null;
    unit_cost: number;
  }[];
}

export interface MethodTotal {
  method: PaymentMethod;
  orders: number;
  amount: number;
}

/** Resumen de caja del día (pedidos sin cancelar). */
export interface CashSession {
  id: string;
  business_day: string;
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  closing_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
}

export interface CashStatus {
  open: CashSession | null;
  cash_sales: number;
  expected_cash: number;
  history: CashSession[];
}

export interface ProductProfit {
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface DaySummary {
  business_day: string;
  orders: number;
  total: number;
  cost: number;
  profit: number;
  paid_total: number;
  by_payment: MethodTotal[];
  pending_orders: number;
  pending_total: number;
}

/* ---------- App / impresora ---------- */

export interface AppStatus {
  supabase_configured: boolean;
  supabase_url: string | null;
  logged_in: boolean;
  user_email: string | null;
  online: boolean;
  pending_sync: number;
  last_menu_sync: string | null;
}

export type PrinterTarget =
  | { kind: "windows"; name: string }
  | { kind: "serial"; port: string; baud: number }
  | { kind: "network"; host: string; port: number };

export interface PrinterConfig {
  target: PrinterTarget | null;
  paper_width: 58 | 80;
  auto_print_kitchen: boolean;
  auto_print_receipt: boolean;
  open_drawer_on_cash: boolean;
  kitchen_copies: number;
}

export interface AvailablePrinters {
  windows: string[];
  serial: string[];
}
