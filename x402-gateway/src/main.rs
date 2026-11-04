use anyhow::{Result, bail};
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber::EnvFilter;
use x402_gateway::api::{AppState, HealthCache};
use x402_gateway::config::{Config, SCHEMA_VERSION};
use x402_gateway::store::{PriceRule, Store};
use x402_gateway::x402::HttpFacilitator;

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("-healthcheck") {
        std::process::exit(healthcheck().await);
    }

    let config = Config::load()?;
    init_tracing(&config.log_level);

    let store = Store::connect(&config.database_url).await?;
    let version = store.schema_version().await?;
    if version < SCHEMA_VERSION {
        bail!(
            "database schema version {version} is behind {SCHEMA_VERSION}; run the migrate binary"
        );
    }

    let (expired, orphaned) = store.reconcile_stale(Utc::now()).await?;
    if expired > 0 || orphaned > 0 {
        tracing::warn!(expired, orphaned, "reconciled stale payments");
    }

    if let Some(price) = config.price_atomic {
        store
            .upsert_price(&PriceRule {
                model: "echo".to_string(),
                price_atomic: price,
                max_output_tokens: 0,
                active: true,
            })
            .await?;
    }

    let facilitator = Arc::new(HttpFacilitator::new(
        &config.facilitator_url,
        config.facilitator_timeout_secs,
    )?);

    let state = AppState {
        config: Arc::new(config.clone()),
        store,
        facilitator,
        health: Arc::new(Mutex::new(HealthCache::default())),
    };
    let app = x402_gateway::api::router(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(
        addr = %listener.local_addr()?,
        network = %config.network,
        "x402-gateway listening"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing(level: &str) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(level));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .init();
}

async fn healthcheck() -> i32 {
    let port = std::env::var("X402_PORT").unwrap_or_else(|_| "4330".to_string());
    let url = format!("http://127.0.0.1:{port}/health");
    match reqwest::Client::new().get(url).send().await {
        Ok(response) if response.status().is_success() => 0,
        _ => 1,
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
