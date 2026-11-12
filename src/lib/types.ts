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
  fetched_at: string;
}

/* ---------- Menú armado para la UI ---------- */

export type MenuOptionGroup = OptionGroupRow & { options: OptionRow[] };
export type MenuProduct = ProductRow & { optionGroups: MenuOptionGroup[] };
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
}

export interface Order {
  id: string;
  ticket_number: number;
  business_day: string;
  customer_name: string | null;
  order_type: OrderType;
  status: OrderStatus;
  total: number;
  payment_method: PaymentMethod;
  cash_received: number | null;
  notes: string | null;
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
  }[];
}

export interface DaySummary {
  business_day: string;
  orders: number;
  total: number;
  by_payment: [PaymentMethod, number][];
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
