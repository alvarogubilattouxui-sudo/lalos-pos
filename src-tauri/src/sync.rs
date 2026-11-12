//! Worker en segundo plano:
//! - sube a Supabase los pedidos que quedaron pendientes (nuevos o con cambio de estado);
//! - refresca la copia local del menú cada minuto.
//! Si no hay internet, no pasa nada: la caja sigue con SQLite y reintenta.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use chrono::{SecondsFormat, Utc};

use crate::db::{kv_get, kv_set};
use crate::error::AppResult;
use crate::orders::{self, Order};
use crate::printer;
use crate::state::AppState;
use crate::supabase;

/// Cada cuánto se revisan pedidos nuevos de la web (y se suben los propios).
const LOOP_EVERY: Duration = Duration::from_secs(8);
const MENU_EVERY: Duration = Duration::from_secs(60);
const KV_WEB_DESDE: &str = "web_orders_desde";

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Al abrir: intenta recuperar la sesión guardada
        {
            let state = app.state::<AppState>();
            let _ = supabase::restore_session(&state).await;
        }

        let mut last_menu: Option<Instant> = None;
        loop {
            let notify = {
                let state = app.state::<AppState>();
                if supabase::has_credentials(&state) && supabase::config(&state).is_ok() {
                    if let Ok(n) = push_orders(&state).await {
                        if n > 0 {
                            let _ = app.emit("orders-synced", n);
                        }
                    }
                    // Pedidos de la web: entran a la caja y salen comanda sola
                    if let Ok(nuevos) = pull_web_orders(&state).await {
                        if !nuevos.is_empty() {
                            let cfg = printer::load_config(&state).ok();
                            let mut print_error: Option<String> = None;
                            for order in &nuevos {
                                let Some(cfg) = cfg.clone() else { break };
                                let order = order.clone();
                                let res = tauri::async_runtime::spawn_blocking(move || printer::print_kitchen(&cfg, &order))
                                    .await
                                    .map_err(|e| e.to_string())
                                    .and_then(|r| r.map_err(|e| e.to_string()));
                                if let Err(e) = res {
                                    print_error = Some(e);
                                }
                            }
                            let _ = app.emit(
                                "web-order",
                                serde_json::json!({ "count": nuevos.len(), "tickets": nuevos.iter().map(|o| o.ticket_number).collect::<Vec<_>>(), "print_error": print_error }),
                            );
                            let _ = app.emit("orders-synced", nuevos.len());
                        }
                    }
                    let due = last_menu.map(|t| t.elapsed() >= MENU_EVERY).unwrap_or(true);
                    if due && supabase::refresh_menu_cache(&state).await.is_ok() {
                        last_menu = Some(Instant::now());
                        let _ = app.emit("menu-updated", ());
                    }
                }
                state.sync_notify.clone()
            };

            tokio::select! {
                _ = tokio::time::sleep(LOOP_EVERY) => {},
                _ = notify.notified() => {},
            }
        }
    });
}

/// Trae de Supabase los pedidos hechos desde la web que todavía no están en esta caja.
/// Recuerda hasta cuándo leyó (kv) para no bajar todo cada vez; se solapa unos minutos por las dudas.
pub async fn pull_web_orders(state: &AppState) -> AppResult<Vec<Order>> {
    let guardado = {
        let conn = state.db();
        kv_get(&conn, KV_WEB_DESDE)?
    };
    let desde = guardado
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(&v).ok().map(|d| d.with_timezone(&Utc)))
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(2))
        - chrono::Duration::minutes(5);

    let path = format!(
        "orders?source=eq.web&created_at=gte.{}&select=*,order_items(*)&order=created_at.asc&limit=200",
        desde.to_rfc3339_opts(SecondsFormat::Secs, true)
    );
    let rows = supabase::get(state, &path).await?;
    let rows = rows.as_array().cloned().unwrap_or_default();

    let mut conn = state.db();
    let nuevos = orders::import_web_orders(&mut conn, &rows)?;
    if let Some(ultimo) = rows.iter().filter_map(|r| r["created_at"].as_str()).max() {
        kv_set(&conn, KV_WEB_DESDE, ultimo)?;
    }
    Ok(nuevos)
}

/// Sube hasta 25 pedidos pendientes. Devuelve cuántos se sincronizaron.
pub async fn push_orders(state: &AppState) -> AppResult<usize> {
    let pending = {
        let conn = state.db();
        orders::unsynced(&conn, 25)?
    };
    let mut done = 0;
    for order in pending {
        match supabase::rpc(state, "pos_upsert_order", &serde_json::json!({ "p": order.to_cloud_payload() })).await {
            Ok(_) => {
                let conn = state.db();
                orders::mark_synced(&conn, &order.id, &order.updated_at)?;
                done += 1;
            }
            Err(e) => {
                let network = e.is_network();
                {
                    let conn = state.db();
                    orders::mark_sync_error(&conn, &order.id, &e.to_string())?;
                }
                if network {
                    break; // sin internet: no tiene sentido seguir intentando ahora
                }
            }
        }
    }
    Ok(done)
}
