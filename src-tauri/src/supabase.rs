//! Cliente de Supabase que vive SOLO en Rust.
//!
//! Seguridad: el POS no usa la service_role. Inicia sesión con un usuario de Supabase Auth
//! (ej: caja@lalos...) que figura en la tabla `staff`; las políticas RLS le dan escritura.
//! El refresh token se guarda en el Administrador de credenciales de Windows.
//! El WebView nunca ve tokens ni claves.

use std::sync::atomic::Ordering;

use chrono::Utc;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::{self, keys};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Session};

const KEYRING_SERVICE: &str = "lalos-pos";
const KEYRING_USER: &str = "supabase-refresh-token";

pub struct Config {
    pub url: String,
    pub anon_key: String,
}

/// URL y anon key: primero lo guardado en Configuración; si no, lo compilado con variables de entorno.
pub fn config(state: &AppState) -> AppResult<Config> {
    let (url, key) = {
        let conn = state.db();
        (db::kv_get(&conn, keys::SUPABASE_URL)?, db::kv_get(&conn, keys::SUPABASE_ANON_KEY)?)
    };
    let url = url.or_else(|| option_env!("LALOS_SUPABASE_URL").map(String::from)).unwrap_or_default();
    let anon_key = key.or_else(|| option_env!("LALOS_SUPABASE_ANON_KEY").map(String::from)).unwrap_or_default();
    if url.is_empty() || anon_key.is_empty() {
        return Err(AppError::NotConfigured);
    }
    Ok(Config { url: url.trim_end_matches('/').to_string(), anon_key })
}

/* ---------------- Auth ---------------- */

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: Option<Value>,
}

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

fn store_refresh_token(token: &str) {
    if let Some(e) = keyring_entry() {
        let _ = e.set_password(token);
    }
}

fn stored_refresh_token() -> Option<String> {
    keyring_entry().and_then(|e| e.get_password().ok())
}

fn clear_refresh_token() {
    if let Some(e) = keyring_entry() {
        let _ = e.delete_credential();
    }
}

async fn token_request(state: &AppState, grant: &str, body: Value, fallback_email: &str) -> AppResult<Session> {
    let cfg = config(state)?;
    let res = state
        .http
        .post(format!("{}/auth/v1/token?grant_type={grant}", cfg.url))
        .header("apikey", &cfg.anon_key)
        .json(&body)
        .send()
        .await;
    let res = track_online(state, res)?;
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        if status.as_u16() == 400 || status.as_u16() == 401 {
            return Err(AppError::msg("Usuario o contraseña incorrectos (o la sesión venció)."));
        }
        return Err(AppError::Supabase { status: status.as_u16(), body: text });
    }
    let t: TokenResponse = serde_json::from_str(&text)?;
    let email = t
        .user
        .as_ref()
        .and_then(|u| u.get("email"))
        .and_then(|e| e.as_str())
        .unwrap_or(fallback_email)
        .to_string();
    let session = Session {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Utc::now().timestamp() + t.expires_in - 60,
        email,
    };
    store_refresh_token(&session.refresh_token);
    state.set_session(Some(session.clone()));
    Ok(session)
}

pub async fn sign_in(state: &AppState, email: &str, password: &str) -> AppResult<Session> {
    let session = token_request(state, "password", json!({ "email": email, "password": password }), email).await?;
    // Verifica que el usuario esté habilitado como personal
    let staff = get(state, "staff?select=role,name&limit=1").await?;
    if staff.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        sign_out(state);
        return Err(AppError::msg("Ese usuario no está habilitado en la tabla staff de Supabase."));
    }
    Ok(session)
}

pub fn sign_out(state: &AppState) {
    state.set_session(None);
    clear_refresh_token();
}

/// Restaura la sesión guardada (al abrir la app). Si no hay internet, se reintenta luego.
pub async fn restore_session(state: &AppState) -> AppResult<Option<Session>> {
    if state.session().is_some() {
        return Ok(state.session());
    }
    let Some(rt) = stored_refresh_token() else { return Ok(None) };
    match token_request(state, "refresh_token", json!({ "refresh_token": rt }), "").await {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.is_network() => Err(e),
        Err(e) => {
            // Token inválido: hay que volver a loguearse
            clear_refresh_token();
            Err(e)
        }
    }
}

pub fn has_credentials(state: &AppState) -> bool {
    state.session().is_some() || stored_refresh_token().is_some()
}

async fn access_token(state: &AppState) -> AppResult<String> {
    let current = state.session();
    match current {
        Some(s) if s.expires_at > Utc::now().timestamp() => Ok(s.access_token),
        Some(s) => {
            let refreshed = token_request(state, "refresh_token", json!({ "refresh_token": s.refresh_token }), &s.email).await?;
            Ok(refreshed.access_token)
        }
        None => match restore_session(state).await? {
            Some(s) => Ok(s.access_token),
            None => Err(AppError::NotLoggedIn),
        },
    }
}

fn track_online(state: &AppState, res: reqwest::Result<reqwest::Response>) -> AppResult<reqwest::Response> {
    state.online.store(res.is_ok(), Ordering::Relaxed);
    Ok(res?)
}

/* ---------------- PostgREST ---------------- */

pub async fn request(state: &AppState, method: Method, path: &str, body: Option<&Value>, prefer: Option<&str>) -> AppResult<Value> {
    let cfg = config(state)?;
    let token = access_token(state).await?;
    let mut req = state
        .http
        .request(method, format!("{}/rest/v1/{}", cfg.url, path))
        .header("apikey", &cfg.anon_key)
        .bearer_auth(token);
    if let Some(p) = prefer {
        req = req.header("Prefer", p);
    }
    if let Some(b) = body {
        req = req.json(b);
    }
    let res = track_online(state, req.send().await)?;
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        return Err(AppError::Supabase { status: status.as_u16(), body: text });
    }
    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        Ok(serde_json::from_str(&text)?)
    }
}

pub async fn get(state: &AppState, path: &str) -> AppResult<Value> {
    request(state, Method::GET, path, None, None).await
}

pub async fn rpc(state: &AppState, function: &str, args: &Value) -> AppResult<Value> {
    request(state, Method::POST, &format!("rpc/{function}"), Some(args), None).await
}

/* ---------------- Menú ---------------- */

/// Descarga las tablas del menú completas (incluye inactivos: el admin los necesita)
/// y las guarda como copia local para trabajar offline.
pub async fn refresh_menu_cache(state: &AppState) -> AppResult<Value> {
    let (categories, products, option_groups, options, product_option_groups, promotions, product_costs, option_costs) = tokio::try_join!(
        get(state, "categories?select=*&order=display_order"),
        get(state, "products?select=*&order=display_order"),
        get(state, "option_groups?select=*&order=display_order"),
        get(state, "options?select=*&order=display_order"),
        get(state, "product_option_groups?select=*&order=display_order"),
        get(state, "promotions?select=*&order=created_at.desc"),
        // Costos: solo personal (la landing no tiene acceso a estas tablas)
        get(state, "product_costs?select=*"),
        get(state, "option_costs?select=*"),
    )?;
    let now = Utc::now().to_rfc3339();
    let snapshot = json!({
        "categories": categories,
        "products": products,
        "option_groups": option_groups,
        "options": options,
        "product_option_groups": product_option_groups,
        "promotions": promotions,
        "product_costs": product_costs,
        "option_costs": option_costs,
        "fetched_at": now,
    });
    {
        let conn = state.db();
        db::kv_set(&conn, keys::MENU_SNAPSHOT, &snapshot.to_string())?;
        db::kv_set(&conn, keys::MENU_SYNCED_AT, &now)?;
        // Pedidos de hoy guardados sin costo: se completan con los costos que llegaron
        let _ = crate::orders::fill_missing_costs(&conn, &snapshot);
    }
    Ok(snapshot)
}

pub fn cached_menu(state: &AppState) -> AppResult<Option<Value>> {
    let raw = {
        let conn = state.db();
        db::kv_get(&conn, keys::MENU_SNAPSHOT)?
    };
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}
