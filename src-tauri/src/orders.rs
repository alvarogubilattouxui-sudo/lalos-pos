//! Pedidos en SQLite local.

use chrono::{Duration, Local, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub const PAYMENT_METHODS: &[&str] = &["cash", "card", "qr", "transfer"];
pub const ORDER_TYPES: &[&str] = &["takeaway", "local", "delivery"];
pub const STATUSES: &[&str] = &["pending", "preparing", "ready", "delivered", "cancelled"];

#[derive(Debug, Deserialize)]
pub struct NewOrderItem {
    pub product_id: Option<String>,
    pub product_name: String,
    pub unit_price: f64,
    pub quantity: i64,
    pub modifications: Option<String>,
    /// Costo de un ítem (producto + agregados) para calcular la ganancia del día.
    #[serde(default)]
    pub unit_cost: f64,
}

#[derive(Debug, Deserialize)]
pub struct NewOrder {
    pub customer_name: Option<String>,
    pub order_type: String,
    pub payment_method: String,
    pub cash_received: Option<f64>,
    pub notes: Option<String>,
    pub items: Vec<NewOrderItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderItem {
    pub id: String,
    pub product_id: Option<String>,
    pub product_name: String,
    pub unit_price: f64,
    pub quantity: i64,
    pub modifications: Option<String>,
    pub subtotal: f64,
    pub unit_cost: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Order {
    pub id: String,
    pub ticket_number: i64,
    pub business_day: String,
    pub customer_name: Option<String>,
    pub order_type: String,
    pub status: String,
    pub total: f64,
    /// Medio con el que eligió pagar (web) o con el que se cobró (caja).
    pub payment_method: String,
    pub cash_received: Option<f64>,
    pub notes: Option<String>,
    /// Horario de retiro elegido por el cliente en la web ("HH:MM"). None = lo antes posible.
    pub pickup_time: Option<String>,
    /// Cuándo se cobró. None = todavía sin cobrar (pedidos web).
    pub paid_at: Option<String>,
    pub paid_method: Option<String>,
    pub paid_amount: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
    pub synced: bool,
    pub sync_error: Option<String>,
    pub items: Vec<OrderItem>,
}

impl Order {
    pub fn change(&self) -> Option<f64> {
        self.cash_received.map(|c| round2(c - self.total)).filter(|c| *c > 0.0)
    }

    /// Payload para la función `pos_upsert_order` de Supabase.
    /// (Los datos de cobro y costos quedan solo en esta caja.)
    pub fn to_cloud_payload(&self) -> Value {
        json!({
            "id": self.id,
            "ticket_number": self.ticket_number,
            "business_day": self.business_day,
            "customer_name": self.customer_name,
            "order_type": self.order_type,
            "status": self.status,
            "total": self.total,
            "payment_method": self.payment_method,
            "cash_received": self.cash_received,
            "notes": self.notes,
            "created_at": self.created_at,
            "items": self.items.iter().map(|i| json!({
                "id": i.id,
                "product_id": i.product_id,
                "product_name": i.product_name,
                "product_price": i.unit_price,
                "quantity": i.quantity,
                "modifications": i.modifications,
                "subtotal": i.subtotal,
            })).collect::<Vec<_>>(),
        })
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// "Día de caja": lo vendido después de medianoche cuenta para la noche anterior.
pub fn business_day_offset(days_back: i64) -> String {
    (Local::now() - Duration::hours(6) - Duration::days(days_back))
        .format("%Y-%m-%d")
        .to_string()
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn insert(conn: &mut Connection, input: NewOrder) -> AppResult<Order> {
    if input.items.is_empty() {
        return Err(AppError::msg("El pedido está vacío"));
    }
    if !PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::msg("Medio de pago inválido"));
    }
    if !ORDER_TYPES.contains(&input.order_type.as_str()) {
        return Err(AppError::msg("Tipo de pedido inválido"));
    }

    let id = Uuid::new_v4().to_string();
    let day = business_day_offset(0);
    let now = now_utc();

    let items: Vec<OrderItem> = input
        .items
        .into_iter()
        .map(|i| {
            let qty = i.quantity.clamp(1, 99);
            let price = round2(i.unit_price.max(0.0));
            OrderItem {
                id: Uuid::new_v4().to_string(),
                product_id: i.product_id,
                product_name: i.product_name.trim().to_string(),
                unit_price: price,
                quantity: qty,
                modifications: clean(i.modifications),
                subtotal: round2(price * qty as f64),
                unit_cost: round2(i.unit_cost.max(0.0)),
            }
        })
        .collect();
    let total = round2(items.iter().map(|i| i.subtotal).sum());

    if input.payment_method == "cash" {
        if let Some(cash) = input.cash_received {
            if cash + 0.001 < total {
                return Err(AppError::msg("El efectivo recibido no alcanza para el total"));
            }
        }
    }

    let tx = conn.transaction()?;
    let ticket_number: i64 = tx.query_row(
        "SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM orders WHERE business_day = ?1",
        [&day],
        |r| r.get(0),
    )?;

    let customer_name = clean(input.customer_name);
    let notes = clean(input.notes);
    let cash_received = if input.payment_method == "cash" { input.cash_received } else { None };

    // En caja el pedido se cobra al confirmarlo: queda cobrado al mismo momento
    tx.execute(
        "INSERT INTO orders (id, ticket_number, business_day, customer_name, order_type, status, total,
                             payment_method, cash_received, notes, created_at, updated_at, synced,
                             paid_at, paid_method, paid_amount)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?10, 0, ?10, ?7, ?6)",
        params![
            id, ticket_number, day, customer_name, input.order_type, total,
            input.payment_method, cash_received, notes, now
        ],
    )?;
    for it in &items {
        tx.execute(
            "INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, modifications, subtotal, unit_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![it.id, id, it.product_id, it.product_name, it.unit_price, it.quantity, it.modifications, it.subtotal, it.unit_cost],
        )?;
    }
    tx.commit()?;

    Ok(Order {
        id,
        ticket_number,
        business_day: day,
        customer_name,
        order_type: input.order_type,
        status: "pending".into(),
        total,
        payment_method: input.payment_method.clone(),
        cash_received,
        notes,
        pickup_time: None,
        paid_at: Some(now.clone()),
        paid_method: Some(input.payment_method),
        paid_amount: Some(total),
        created_at: now.clone(),
        updated_at: now,
        synced: false,
        sync_error: None,
        items,
    })
}

const ORDER_COLS: &str = "id, ticket_number, business_day, customer_name, order_type, status, total, payment_method,
                          cash_received, notes, created_at, updated_at, synced, sync_error,
                          pickup_time, paid_at, paid_method, paid_amount";

fn map_order(r: &Row) -> rusqlite::Result<Order> {
    Ok(Order {
        id: r.get(0)?,
        ticket_number: r.get(1)?,
        business_day: r.get(2)?,
        customer_name: r.get(3)?,
        order_type: r.get(4)?,
        status: r.get(5)?,
        total: r.get(6)?,
        payment_method: r.get(7)?,
        cash_received: r.get(8)?,
        notes: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        synced: r.get::<_, i64>(12)? == 1,
        sync_error: r.get(13)?,
        pickup_time: r.get(14)?,
        paid_at: r.get(15)?,
        paid_method: r.get(16)?,
        paid_amount: r.get(17)?,
        items: Vec::new(),
    })
}

fn load_items(conn: &Connection, order: &mut Order) -> AppResult<()> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, product_id, product_name, unit_price, quantity, modifications, subtotal, unit_cost
         FROM order_items WHERE order_id = ?1 ORDER BY rowid",
    )?;
    order.items = stmt
        .query_map([&order.id], |r| {
            Ok(OrderItem {
                id: r.get(0)?,
                product_id: r.get(1)?,
                product_name: r.get(2)?,
                unit_price: r.get(3)?,
                quantity: r.get(4)?,
                modifications: r.get(5)?,
                subtotal: r.get(6)?,
                unit_cost: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(())
}

fn query_orders(conn: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> AppResult<Vec<Order>> {
    let mut stmt = conn.prepare(sql)?;
    let mut orders = stmt.query_map(args, map_order)?.collect::<Result<Vec<_>, _>>()?;
    for o in orders.iter_mut() {
        load_items(conn, o)?;
    }
    Ok(orders)
}

/// Pedidos hechos desde la web (Supabase, source = 'web'): los guarda en esta caja con su número de ticket.
/// Ya están en la nube, así que quedan como sincronizados. Los que ya existen localmente se ignoran.
/// Entran SIN cobrar: se cobran en la caja al retirar.
pub fn import_web_orders(conn: &mut Connection, rows: &[Value]) -> AppResult<Vec<Order>> {
    let mut imported = Vec::new();
    for row in rows {
        let Some(id) = row["id"].as_str().map(str::to_string) else { continue };
        let already: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM orders WHERE id = ?1)", [&id], |r| r.get(0))?;
        if already {
            continue;
        }

        let day = row["business_day"].as_str().unwrap_or_default().to_string();
        let created = row["created_at"].as_str().unwrap_or_default().to_string();
        let updated = row["updated_at"].as_str().unwrap_or(created.as_str()).to_string();
        let total = row["total"].as_f64().unwrap_or(0.0);

        let tx = conn.transaction()?;
        let ticket: i64 = tx.query_row(
            "SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM orders WHERE business_day = ?1",
            [&day],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO orders (id, ticket_number, business_day, customer_name, order_type, status, total,
                                 payment_method, cash_received, notes, created_at, updated_at, synced, pickup_time)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, 1, ?12)",
            params![
                id,
                ticket,
                day,
                row["customer_name"].as_str(),
                row["order_type"].as_str().unwrap_or("takeaway"),
                row["status"].as_str().unwrap_or("pending"),
                total,
                row["payment_method"].as_str().unwrap_or("cash"),
                row["notes"].as_str(),
                created,
                updated,
                row["pickup_time"].as_str().map(|t| t.chars().take(5).collect::<String>()),
            ],
        )?;
        for it in row["order_items"].as_array().cloned().unwrap_or_default() {
            tx.execute(
                "INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, modifications, subtotal, unit_cost)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    it["id"].as_str().unwrap_or_default(),
                    id,
                    it["product_id"].as_str(),
                    it["product_name"].as_str().unwrap_or_default(),
                    it["product_price"].as_f64().unwrap_or(0.0),
                    it["quantity"].as_i64().unwrap_or(1),
                    it["modifications"].as_str(),
                    it["subtotal"].as_f64().unwrap_or(0.0),
                    it["unit_cost"].as_f64().unwrap_or(0.0),
                ],
            )?;
        }
        tx.commit()?;
        imported.push(get(conn, &id)?);
    }
    Ok(imported)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Order> {
    let sql = format!("SELECT {ORDER_COLS} FROM orders WHERE id = ?1");
    let mut order = conn
        .query_row(&sql, [id], map_order)
        .optional()?
        .ok_or_else(|| AppError::msg("Pedido no encontrado"))?;
    load_items(conn, &mut order)?;
    Ok(order)
}

/// Pedidos para el KDS: activos de hoy y de ayer (por si quedó algo colgado), más viejos primero.
pub fn list_kitchen(conn: &Connection) -> AppResult<Vec<Order>> {
    let since = business_day_offset(1);
    let sql = format!(
        "SELECT {ORDER_COLS} FROM orders
         WHERE status IN ('pending', 'preparing', 'ready') AND business_day >= ?1
         ORDER BY created_at ASC"
    );
    query_orders(conn, &sql, &[&since])
}

/// Últimos pedidos del día (para reimprimir y cobrar desde la caja).
pub fn list_today(conn: &Connection, limit: i64) -> AppResult<Vec<Order>> {
    let day = business_day_offset(0);
    let sql = format!("SELECT {ORDER_COLS} FROM orders WHERE business_day = ?1 ORDER BY ticket_number DESC LIMIT ?2");
    query_orders(conn, &sql, &[&day, &limit])
}

pub fn update_status(conn: &Connection, id: &str, status: &str) -> AppResult<()> {
    if !STATUSES.contains(&status) {
        return Err(AppError::msg("Estado inválido"));
    }
    let n = conn.execute(
        "UPDATE orders SET status = ?1, updated_at = ?2, synced = 0 WHERE id = ?3",
        params![status, now_utc(), id],
    )?;
    if n == 0 {
        return Err(AppError::msg("Pedido no encontrado"));
    }
    Ok(())
}

/// Registra el cobro de un pedido (efectivo, débito, QR o transferencia, y el importe cobrado).
/// Es solo local: no modifica el pedido en la nube, así no se vuelve a subir.
pub fn mark_paid(conn: &Connection, id: &str, method: &str, amount: f64) -> AppResult<()> {
    if !PAYMENT_METHODS.contains(&method) {
        return Err(AppError::msg("Medio de pago inválido"));
    }
    if !amount.is_finite() || amount <= 0.0 {
        return Err(AppError::msg("El importe tiene que ser mayor a cero"));
    }
    let n = conn.execute(
        "UPDATE orders SET paid_at = ?1, paid_method = ?2, paid_amount = ?3
         WHERE id = ?4 AND status <> 'cancelled'",
        params![now_utc(), method, round2(amount), id],
    )?;
    if n == 0 {
        return Err(AppError::msg("Pedido no encontrado o cancelado"));
    }
    Ok(())
}

pub fn unsynced(conn: &Connection, limit: i64) -> AppResult<Vec<Order>> {
    let sql = format!("SELECT {ORDER_COLS} FROM orders WHERE synced = 0 ORDER BY created_at ASC LIMIT ?1");
    query_orders(conn, &sql, &[&limit])
}

pub fn count_unsynced(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM orders WHERE synced = 0", [], |r| r.get(0))?)
}

/// Marca como sincronizado solo si nadie lo modificó mientras se subía.
pub fn mark_synced(conn: &Connection, id: &str, updated_at: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE orders SET synced = 1, sync_error = NULL WHERE id = ?1 AND updated_at = ?2",
        params![id, updated_at],
    )?;
    Ok(())
}

pub fn mark_sync_error(conn: &Connection, id: &str, error: &str) -> AppResult<()> {
    conn.execute("UPDATE orders SET sync_error = ?1 WHERE id = ?2", params![error, id])?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct MethodTotal {
    pub method: String,
    pub orders: i64,
    pub amount: f64,
}

#[derive(Debug, Serialize)]
pub struct DaySummary {
    pub business_day: String,
    /// Pedidos del día (sin cancelados) y lo vendido en total.
    pub orders: i64,
    pub total: f64,
    /// Costo de lo vendido y ganancia neta (vendido − costo).
    pub cost: f64,
    pub profit: f64,
    /// Lo que ya se cobró, por medio de pago.
    pub paid_total: f64,
    pub by_payment: Vec<MethodTotal>,
    /// Lo que todavía no se cobró (pedidos web que se retiran y se pagan en la caja).
    pub pending_orders: i64,
    pub pending_total: f64,
}

/// Resumen de caja del día: vendido, costo, ganancia, cobrado por medio y pendiente.
pub fn day_summary(conn: &Connection) -> AppResult<DaySummary> {
    let day = business_day_offset(0);

    let (orders, total, cost): (i64, f64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(o.total), 0), COALESCE(SUM(c.cost), 0)
           FROM orders o
           LEFT JOIN (SELECT order_id, SUM(quantity * unit_cost) AS cost FROM order_items GROUP BY order_id) c
                  ON c.order_id = o.id
          WHERE o.business_day = ?1 AND o.status <> 'cancelled'",
        [&day],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let (pending_orders, pending_total): (i64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM orders
          WHERE business_day = ?1 AND status <> 'cancelled' AND paid_at IS NULL",
        [&day],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT COALESCE(paid_method, 'cash'), COUNT(*), COALESCE(SUM(paid_amount), 0) FROM orders
          WHERE business_day = ?1 AND status <> 'cancelled' AND paid_at IS NOT NULL
          GROUP BY COALESCE(paid_method, 'cash')
          ORDER BY SUM(paid_amount) DESC",
    )?;
    let by_payment = stmt
        .query_map([&day], |r| {
            Ok(MethodTotal {
                method: r.get(0)?,
                orders: r.get(1)?,
                amount: round2(r.get(2)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let paid_total = round2(by_payment.iter().map(|m| m.amount).sum());

    Ok(DaySummary {
        business_day: day,
        orders,
        total: round2(total),
        cost: round2(cost),
        profit: round2(total - cost),
        paid_total,
        by_payment,
        pending_orders,
        pending_total: round2(pending_total),
    })
}

/// Ganancia de cada producto vendido en el día (sin cancelados).
#[derive(Debug, Serialize)]
pub struct ProductProfit {
    pub name: String,
    pub quantity: i64,
    pub revenue: f64,
    pub cost: f64,
    pub profit: f64,
}

pub fn day_products(conn: &Connection) -> AppResult<Vec<ProductProfit>> {
    let day = business_day_offset(0);
    let mut stmt = conn.prepare(
        "SELECT oi.product_name, SUM(oi.quantity), COALESCE(SUM(oi.subtotal), 0), COALESCE(SUM(oi.quantity * oi.unit_cost), 0)
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.business_day = ?1 AND o.status <> 'cancelled'
          GROUP BY oi.product_name
          ORDER BY SUM(oi.subtotal) DESC",
    )?;
    let rows = stmt
        .query_map([&day], |r| {
            let revenue: f64 = r.get(2)?;
            let cost: f64 = r.get(3)?;
            Ok(ProductProfit {
                name: r.get(0)?,
                quantity: r.get(1)?,
                revenue: round2(revenue),
                cost: round2(cost),
                profit: round2(revenue - cost),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Completa el costo de los ítems guardados sin costo (pedidos hechos antes de cargar los costos).
/// Usa el costo del producto más el de las personalizaciones que figuran en `modifications`.
/// Se ejecuta cada vez que se actualiza el menú desde Supabase.
pub fn fill_missing_costs(conn: &Connection, snapshot: &Value) -> AppResult<usize> {
    fn num(v: &Value) -> f64 {
        v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0)
    }

    let mut product_cost: std::collections::HashMap<String, f64> = Default::default();
    for r in snapshot["product_costs"].as_array().into_iter().flatten() {
        if let Some(id) = r["id"].as_str() {
            product_cost.insert(id.to_string(), num(&r["cost"]));
        }
    }

    let mut option_name: std::collections::HashMap<String, String> = Default::default();
    for o in snapshot["options"].as_array().into_iter().flatten() {
        if let (Some(id), Some(name)) = (o["id"].as_str(), o["name"].as_str()) {
            option_name.insert(id.to_string(), name.trim().to_lowercase());
        }
    }
    let mut option_cost: std::collections::HashMap<String, f64> = Default::default();
    for r in snapshot["option_costs"].as_array().into_iter().flatten() {
        if let Some(name) = r["id"].as_str().and_then(|id| option_name.get(id)) {
            option_cost.insert(name.clone(), num(&r["cost"]));
        }
    }

    let pending: Vec<(String, String, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, product_id, modifications FROM order_items
              WHERE (unit_cost IS NULL OR unit_cost = 0) AND product_id IS NOT NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    let mut updated = 0;
    for (id, product_id, mods) in pending {
        let mut unit = product_cost.get(&product_id).copied().unwrap_or(0.0);
        if let Some(m) = &mods {
            for token in m.split(|c: char| c == '·' || c == ':' || c == ',') {
                if let Some(c) = option_cost.get(&token.trim().to_lowercase()) {
                    unit += c;
                }
            }
        }
        if unit > 0.0 {
            conn.execute("UPDATE order_items SET unit_cost = ?1 WHERE id = ?2", params![round2(unit), id])?;
            updated += 1;
        }
    }
    Ok(updated)
}

/* ---------------- Caja: apertura y cierre diario ---------------- */

#[derive(Debug, Serialize, Clone)]
pub struct CashSession {
    pub id: String,
    pub business_day: String,
    pub opened_at: String,
    pub opening_cash: f64,
    pub closed_at: Option<String>,
    pub closing_cash: Option<f64>,
    pub expected_cash: Option<f64>,
    pub difference: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct CashStatus {
    /// Caja abierta (si hay una sin cerrar).
    pub open: Option<CashSession>,
    /// Cobros en efectivo desde la apertura (solo con caja abierta).
    pub cash_sales: f64,
    /// Lo que debería haber en la caja: apertura + cobros en efectivo.
    pub expected_cash: f64,
    pub history: Vec<CashSession>,
}

const CASH_COLS: &str = "id, business_day, opened_at, opening_cash, closed_at, closing_cash, expected_cash, difference";

fn cash_row(r: &Row) -> rusqlite::Result<CashSession> {
    Ok(CashSession {
        id: r.get(0)?,
        business_day: r.get(1)?,
        opened_at: r.get(2)?,
        opening_cash: r.get(3)?,
        closed_at: r.get(4)?,
        closing_cash: r.get(5)?,
        expected_cash: r.get(6)?,
        difference: r.get(7)?,
    })
}

fn open_session(conn: &Connection) -> AppResult<Option<CashSession>> {
    Ok(conn
        .query_row(
            &format!("SELECT {CASH_COLS} FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1"),
            [],
            cash_row,
        )
        .optional()?)
}

/// Efectivo cobrado desde que se abrió la caja (pedidos sin cancelar).
fn cash_sales_since(conn: &Connection, opened_at: &str) -> AppResult<f64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(paid_amount), 0) FROM orders
          WHERE paid_method = 'cash' AND paid_at IS NOT NULL AND paid_at >= ?1 AND status <> 'cancelled'",
        [opened_at],
        |r| r.get::<_, f64>(0),
    )?)
}

pub fn cash_status(conn: &Connection) -> AppResult<CashStatus> {
    let open = open_session(conn)?;
    let (cash_sales, expected_cash) = match &open {
        Some(s) => {
            let sales = round2(cash_sales_since(conn, &s.opened_at)?);
            (sales, round2(s.opening_cash + sales))
        }
        None => (0.0, 0.0),
    };
    let mut stmt = conn.prepare(&format!("SELECT {CASH_COLS} FROM cash_sessions ORDER BY opened_at DESC LIMIT 15"))?;
    let history = stmt.query_map([], cash_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(CashStatus { open, cash_sales, expected_cash, history })
}

pub fn cash_open(conn: &Connection, opening_cash: f64) -> AppResult<CashStatus> {
    if !opening_cash.is_finite() || opening_cash < 0.0 {
        return Err(AppError::msg("Poné un monto válido de efectivo"));
    }
    if open_session(conn)?.is_some() {
        return Err(AppError::msg("La caja ya está abierta"));
    }
    conn.execute(
        "INSERT INTO cash_sessions (id, business_day, opened_at, opening_cash) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::new_v4().to_string(), business_day_offset(0), now_utc(), round2(opening_cash)],
    )?;
    cash_status(conn)
}

pub fn cash_close(conn: &Connection, closing_cash: f64) -> AppResult<CashStatus> {
    if !closing_cash.is_finite() || closing_cash < 0.0 {
        return Err(AppError::msg("Poné un monto válido de efectivo"));
    }
    let s = open_session(conn)?.ok_or_else(|| AppError::msg("No hay caja abierta"))?;
    let sales = round2(cash_sales_since(conn, &s.opened_at)?);
    let expected = round2(s.opening_cash + sales);
    let counted = round2(closing_cash);
    conn.execute(
        "UPDATE cash_sessions SET closed_at = ?1, closing_cash = ?2, expected_cash = ?3, difference = ?4 WHERE id = ?5",
        params![now_utc(), counted, expected, round2(counted - expected), s.id],
    )?;
    cash_status(conn)
}
