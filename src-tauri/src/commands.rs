//! Comandos expuestos al frontend (`invoke("nombre", { ... })`).
//! Nota: desde JS los argumentos van en camelCase (anonKey, productId…); los campos de
//! los objetos (structs serde) van en snake_case.

use std::sync::atomic::Ordering;

use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::{self, keys};
use crate::error::{AppError, AppResult};
use crate::orders::{self, NewOrder, Order};
use crate::printer::{self, tickets, transport};
use crate::state::AppState;
use crate::supabase;

/* ---------------- Estado general ---------------- */

#[derive(Serialize)]
pub struct AppStatus {
    supabase_configured: bool,
    supabase_url: Option<String>,
    logged_in: bool,
    user_email: Option<String>,
    online: bool,
    pending_sync: i64,
    last_menu_sync: Option<String>,
}

#[tauri::command]
pub fn app_status(state: State<'_, AppState>) -> AppResult<AppStatus> {
    let cfg = supabase::config(&state).ok();
    let session = state.session();
    let conn = state.db();
    Ok(AppStatus {
        supabase_configured: cfg.is_some(),
        supabase_url: cfg.map(|c| c.url),
        logged_in: session.is_some(),
        user_email: session.map(|s| s.email),
        online: state.online.load(Ordering::Relaxed),
        pending_sync: orders::count_unsynced(&conn)?,
        last_menu_sync: db::kv_get(&conn, keys::MENU_SYNCED_AT)?,
    })
}

#[tauri::command]
pub fn save_supabase_config(state: State<'_, AppState>, url: String, anon_key: String) -> AppResult<()> {
    let url = url.trim().trim_end_matches('/').to_string();
    if !url.starts_with("https://") {
        return Err(AppError::msg("La URL tiene que empezar con https://"));
    }
    if anon_key.trim().len() < 20 {
        return Err(AppError::msg("La anon key parece incompleta"));
    }
    // Defensa: no aceptar la service_role / secret key por error.
    // (fragmentos en base64url de `"role":"service_role"` en las 3 alineaciones posibles del JWT)
    const SERVICE_ROLE_B64: [&str; 3] = ["InJvbGUiOiJzZXJ2aWNl", "Jyb2xlIjoic2VydmljZV", "icm9sZSI6InNlcnZpY2V"];
    let k = anon_key.trim();
    if k.starts_with("sb_secret_") || SERVICE_ROLE_B64.iter().any(|f| k.contains(f)) {
        return Err(AppError::msg("Esa es la service_role key. Acá va la anon (public) key."));
    }
    let conn = state.db();
    db::kv_set(&conn, keys::SUPABASE_URL, &url)?;
    db::kv_set(&conn, keys::SUPABASE_ANON_KEY, anon_key.trim())?;
    Ok(())
}

#[tauri::command]
pub async fn login(state: State<'_, AppState>, email: String, password: String) -> AppResult<String> {
    let session = supabase::sign_in(&state, email.trim(), &password).await?;
    state.sync_notify.notify_one();
    Ok(session.email)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) {
    supabase::sign_out(&state);
}

#[tauri::command]
pub fn sync_now(state: State<'_, AppState>) {
    state.sync_notify.notify_one();
}

/* ---------------- Menú ---------------- */

#[derive(Serialize)]
pub struct MenuResponse {
    snapshot: Option<Value>,
    /// "cloud" = recién bajado de Supabase · "cache" = copia local (offline)
    source: &'static str,
    error: Option<String>,
}

#[tauri::command]
pub async fn get_menu(state: State<'_, AppState>, refresh: bool) -> AppResult<MenuResponse> {
    if refresh {
        match supabase::refresh_menu_cache(&state).await {
            Ok(snapshot) => return Ok(MenuResponse { snapshot: Some(snapshot), source: "cloud", error: None }),
            Err(e) => {
                let cached = supabase::cached_menu(&state)?;
                return Ok(MenuResponse { snapshot: cached, source: "cache", error: Some(e.to_string()) });
            }
        }
    }
    let cached = supabase::cached_menu(&state)?;
    Ok(MenuResponse { snapshot: cached, source: "cache", error: None })
}

/* ---------------- Horarios y estado de la tienda ---------------- */

/// Lee los 7 horarios y la fila de estado de la tienda, para la pantalla Local.
#[tauri::command]
pub async fn get_store_state(state: State<'_, AppState>) -> AppResult<Value> {
    let horarios = supabase::get(&state, "horarios?select=*&order=dia_semana.asc").await?;
    let tienda = supabase::get(&state, "tienda?select=*").await?;
    Ok(json!({ "horarios": horarios, "tienda": tienda }))
}

/* ---------------- Admin del menú (escribe en Supabase) ---------------- */

const ADMIN_TABLES: &[&str] = &["categories", "products", "promotions", "option_groups", "options", "horarios", "tienda"];

fn check_table(table: &str) -> AppResult<()> {
    if ADMIN_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(AppError::msg(format!("Tabla no permitida: {table}")))
    }
}

fn check_id(id: &str) -> AppResult<()> {
    Uuid::parse_str(id).map(|_| ()).map_err(|_| AppError::msg("ID inválido"))
}

fn first_row(v: Value) -> Value {
    match v {
        Value::Array(mut a) if !a.is_empty() => a.swap_remove(0),
        other => other,
    }
}

/// Después de cada cambio: refresca la copia local y avisa a la UI.
async fn after_admin_change(app: &AppHandle, state: &AppState) {
    if supabase::refresh_menu_cache(state).await.is_ok() {
        let _ = app.emit("menu-updated", ());
    }
}

#[tauri::command]
pub async fn admin_insert(app: AppHandle, state: State<'_, AppState>, table: String, row: Value) -> AppResult<Value> {
    check_table(&table)?;
    let res = supabase::request(&state, Method::POST, &table, Some(&row), Some("return=representation")).await?;
    after_admin_change(&app, &state).await;
    Ok(first_row(res))
}

#[tauri::command]
pub async fn admin_update(app: AppHandle, state: State<'_, AppState>, table: String, id: String, patch: Value) -> AppResult<Value> {
    check_table(&table)?;
    check_id(&id)?;
    let path = format!("{table}?id=eq.{id}");
    let res = supabase::request(&state, Method::PATCH, &path, Some(&patch), Some("return=representation")).await?;
    after_admin_change(&app, &state).await;
    Ok(first_row(res))
}

#[tauri::command]
pub async fn admin_delete(app: AppHandle, state: State<'_, AppState>, table: String, id: String) -> AppResult<()> {
    check_table(&table)?;
    check_id(&id)?;
    supabase::request(&state, Method::DELETE, &format!("{table}?id=eq.{id}"), None, None).await?;
    after_admin_change(&app, &state).await;
    Ok(())
}

/// Reemplaza los grupos de opciones (Extras, Aderezos…) de un producto.
#[tauri::command]
pub async fn admin_set_product_groups(app: AppHandle, state: State<'_, AppState>, product_id: String, group_ids: Vec<String>) -> AppResult<()> {
    check_id(&product_id)?;
    for g in &group_ids {
        check_id(g)?;
    }
    supabase::request(&state, Method::DELETE, &format!("product_option_groups?product_id=eq.{product_id}"), None, None).await?;
    if !group_ids.is_empty() {
        let rows: Vec<Value> = group_ids
            .iter()
            .enumerate()
            .map(|(i, g)| json!({ "product_id": product_id, "group_id": g, "display_order": i + 1 }))
            .collect();
        supabase::request(&state, Method::POST, "product_option_groups", Some(&Value::Array(rows)), None).await?;
    }
    after_admin_change(&app, &state).await;
    Ok(())
}

/// Ajuste masivo de precios (ej: +8% por inflación), redondeando a `round_to` pesos.
#[tauri::command]
pub async fn admin_adjust_prices(
    app: AppHandle,
    state: State<'_, AppState>,
    percent: f64,
    category_id: Option<String>,
    round_to: f64,
) -> AppResult<i64> {
    if let Some(c) = &category_id {
        check_id(c)?;
    }
    if !(-90.0..=300.0).contains(&percent) {
        return Err(AppError::msg("Porcentaje fuera de rango (-90% a +300%)"));
    }
    let res = supabase::rpc(
        &state,
        "adjust_prices",
        &json!({ "p_percent": percent, "p_category": category_id, "p_round_to": round_to.max(1.0) }),
    )
    .await?;
    after_admin_change(&app, &state).await;
    Ok(res.as_i64().unwrap_or(0))
}

/* ---------------- Pedidos ---------------- */

#[derive(Serialize)]
pub struct CreateOrderResult {
    order: Order,
    print_error: Option<String>,
}

#[tauri::command]
pub async fn create_order(state: State<'_, AppState>, input: NewOrder) -> AppResult<CreateOrderResult> {
    let order = {
        let mut conn = state.db();
        orders::insert(&mut conn, input)?
    };

    // Imprimir en un hilo aparte: la impresora puede tardar y no queremos trabar la UI
    let cfg = printer::load_config(&state)?;
    let to_print = order.clone();
    let print_error = tauri::async_runtime::spawn_blocking(move || printer::print_on_checkout(&cfg, &to_print))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
        .err()
        .map(|e| e.to_string());

    state.sync_notify.notify_one();
    Ok(CreateOrderResult { order, print_error })
}

#[tauri::command]
pub fn list_kitchen_orders(state: State<'_, AppState>) -> AppResult<Vec<Order>> {
    let conn = state.db();
    orders::list_kitchen(&conn)
}

#[tauri::command]
pub fn list_today_orders(state: State<'_, AppState>, limit: Option<i64>) -> AppResult<Vec<Order>> {
    let conn = state.db();
    orders::list_today(&conn, limit.unwrap_or(30))
}

#[tauri::command]
pub fn day_summary(state: State<'_, AppState>) -> AppResult<orders::DaySummary> {
    let conn = state.db();
    orders::day_summary(&conn)
}

#[tauri::command]
pub fn update_order_status(state: State<'_, AppState>, id: String, status: String) -> AppResult<()> {
    {
        let conn = state.db();
        orders::update_status(&conn, &id, &status)?;
    }
    state.sync_notify.notify_one();
    Ok(())
}

/* ---------------- Impresora ---------------- */

#[tauri::command]
pub fn list_printers() -> transport::AvailablePrinters {
    transport::list_available()
}

#[tauri::command]
pub fn get_printer_config(state: State<'_, AppState>) -> AppResult<transport::PrinterConfig> {
    printer::load_config(&state)
}

#[tauri::command]
pub fn save_printer_config(state: State<'_, AppState>, config: transport::PrinterConfig) -> AppResult<()> {
    if config.paper_width != 58 && config.paper_width != 80 {
        return Err(AppError::msg("El ancho de papel tiene que ser 58 u 80 mm"));
    }
    printer::save_config(&state, &config)
}

/// Manda bytes ESC/POS crudos a la impresora configurada.
#[tauri::command]
pub async fn print_raw(state: State<'_, AppState>, bytes: Vec<u8>) -> AppResult<()> {
    let cfg = printer::load_config(&state)?;
    let target = printer::require_target(&cfg)?;
    tauri::async_runtime::spawn_blocking(move || transport::send(&target, &bytes))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn print_test(state: State<'_, AppState>, config: Option<transport::PrinterConfig>) -> AppResult<()> {
    // Permite probar una configuración antes de guardarla
    let cfg = match config {
        Some(c) => c,
        None => printer::load_config(&state)?,
    };
    let target = printer::require_target(&cfg)?;
    let bytes = tickets::test_page(cfg.paper_width);
    tauri::async_runtime::spawn_blocking(move || transport::send(&target, &bytes))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn reprint_order(state: State<'_, AppState>, id: String, kind: String) -> AppResult<()> {
    let order = {
        let conn = state.db();
        orders::get(&conn, &id)?
    };
    let cfg = printer::load_config(&state)?;
    let target = printer::require_target(&cfg)?;
    let bytes = match kind.as_str() {
        "kitchen" => tickets::kitchen(&order, cfg.paper_width, Some("REIMPRESIÓN")),
        "receipt" => tickets::receipt(&order, cfg.paper_width, false),
        _ => return Err(AppError::msg("Tipo de ticket inválido")),
    };
    tauri::async_runtime::spawn_blocking(move || transport::send(&target, &bytes))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}
