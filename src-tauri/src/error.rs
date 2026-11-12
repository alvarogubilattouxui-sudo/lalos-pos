use serde::{Serialize, Serializer};

/// Error único de la app. Se serializa como texto para mostrarlo tal cual en la UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Base local: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Sin conexión con Supabase ({0})")]
    Http(#[from] reqwest::Error),

    #[error("Supabase respondió {status}: {body}")]
    Supabase { status: u16, body: String },

    #[error("Supabase no está configurado. Cargá la URL y la anon key en Configuración.")]
    NotConfigured,

    #[error("Tenés que iniciar sesión en Configuración.")]
    NotLoggedIn,

    #[error("Impresora: {0}")]
    Printer(String),

    #[error("{0}")]
    Msg(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }

    /// Errores que significan "no hay internet / Supabase caído" (reintentar más tarde).
    pub fn is_network(&self) -> bool {
        matches!(self, AppError::Http(_))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
