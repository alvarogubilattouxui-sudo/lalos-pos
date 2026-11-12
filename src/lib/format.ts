import type { OrderStatus, OrderType, PaymentMethod } from "@/lib/types";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export const formatPrice = (v: number) => money.format(Number.isFinite(v) ? v : 0);

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

export const ticketNo = (n: number) => `#${String(n).padStart(3, "0")}`;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Débito / Crédito",
  qr: "QR / MercadoPago",
  transfer: "Transferencia",
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  takeaway: "Para llevar",
  local: "Comer acá",
  delivery: "Delivery",
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Nuevo",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
