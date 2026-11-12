use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use rusqlite::Connection;
use tokio::sync::Notify;

/// Sesión de Supabase Auth del usuario de la caja (NO es la service_role).
#[derive(Clone, Debug)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Epoch (segundos) en que conviene renovar el access token.
    pub expires_at: i64,
    pub email: String,
}

pub struct AppState {
    db: Mutex<Connection>,
    pub http: reqwest::Client,
    pub session: RwLock<Option<Session>>,
    pub online: AtomicBool,
    /// Despierta al worker de sincronización (ej: apenas se cobra un pedido).
    pub sync_notify: Arc<Notify>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("cliente HTTP");
        Self {
            db: Mutex::new(conn),
            http,
            session: RwLock::new(None),
            online: AtomicBool::new(false),
            sync_notify: Arc::new(Notify::new()),
        }
    }

    /// Acceso a SQLite. Nunca mantener el guard a través de un `.await`.
    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn session(&self) -> Option<Session> {
        self.session.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn set_session(&self, s: Option<Session>) {
        *self.session.write().unwrap_or_else(|p| p.into_inner()) = s;
    }
}
