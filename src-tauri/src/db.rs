//! SQLite local: la caja sigue cobrando aunque se corte internet.
//! - `orders` / `order_items`: fuente de verdad local, se suben a Supabase en segundo plano.
//! - `kv`: configuración (Supabase, impresora) y la última copia del menú.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id             TEXT PRIMARY KEY,
    ticket_number  INTEGER NOT NULL,
    business_day   TEXT NOT NULL,
    customer_name  TEXT,
    order_type     TEXT NOT NULL,
    status         TEXT NOT NULL,
    total          REAL NOT NULL,
    payment_method TEXT NOT NULL,
    cash_received  REAL,
    notes          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    synced         INTEGER NOT NULL DEFAULT 0,
    sync_error     TEXT
);
CREATE INDEX IF NOT EXISTS orders_day_idx    ON orders(business_day, ticket_number);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS orders_sync_idx   ON orders(synced);

CREATE TABLE IF NOT EXISTS order_items (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id    TEXT,
    product_name  TEXT NOT NULL,
    unit_price    REAL NOT NULL,
    quantity      INTEGER NOT NULL,
    modifications TEXT,
    subtotal      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE TABLE IF NOT EXISTS cash_sessions (
    id            TEXT PRIMARY KEY,
    business_day  TEXT NOT NULL,
    opened_at     TEXT NOT NULL,
    opening_cash  REAL NOT NULL,
    closed_at     TEXT,
    closing_cash  REAL,
    expected_cash REAL,
    difference    REAL
);
CREATE TABLE IF NOT EXISTS cash_movements (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES cash_sessions(id),
    kind        TEXT NOT NULL,
    amount      REAL NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON cash_movements(session_id);
"#;

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    // WAL: lecturas del KDS no bloquean las escrituras de la caja
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")?;
    conn.execute_batch(SCHEMA)?;

    // Columnas agregadas después: una caja con la base vieja se actualiza sola al abrir
    add_column(&conn, "orders", "pickup_time", "TEXT")?;
    add_column(&conn, "orders", "paid_at", "TEXT")?;
    add_column(&conn, "orders", "paid_method", "TEXT")?;
    add_column(&conn, "orders", "paid_amount", "REAL")?;
    add_column(&conn, "order_items", "unit_cost", "REAL NOT NULL DEFAULT 0")?;

    // Una sola vez: los pedidos anteriores ya estaban cobrados al venderse
    if kv_get(&conn, "migr_cobros_v1")?.is_none() {
        conn.execute(
            "UPDATE orders SET paid_at = created_at, paid_method = payment_method, paid_amount = total
             WHERE paid_at IS NULL",
            [],
        )?;
        kv_set(&conn, "migr_cobros_v1", "1")?;
    }
    Ok(conn)
}

fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) -> AppResult<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |r| r.get(0),
    )?;
    if exists == 0 {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl};"))?;
    }
    Ok(())
}

pub fn kv_get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn kv_set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn kv_delete(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM kv WHERE key = ?1", [key])?;
    Ok(())
}

pub mod keys {
    pub const SUPABASE_URL: &str = "supabase_url";
    pub const SUPABASE_ANON_KEY: &str = "supabase_anon_key";
    pub const MENU_SNAPSHOT: &str = "menu_snapshot";
    pub const MENU_SYNCED_AT: &str = "menu_synced_at";
    pub const PRINTER_CONFIG: &str = "printer_config";
}
