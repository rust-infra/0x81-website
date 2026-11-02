use anyhow::{Result, bail};
use std::env;

pub const SCHEMA_VERSION: i64 = 1;
pub const DEFAULT_PORT: u16 = 4330;
pub const DEFAULT_NETWORK: &str = "eip155:84532";
pub const DEFAULT_ASSET: &str = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
pub const DEFAULT_PUBLIC_BASE_URL: &str = "http://127.0.0.1:4330";
pub const DEFAULT_FACILITATOR_TIMEOUT_SECS: u64 = 10;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub facilitator_url: String,
    pub pay_to: String,
    pub network: String,
    pub asset: String,
    pub asset_symbol: String,
    pub asset_decimals: u8,
    pub asset_name: String,
    pub asset_version: String,
    pub asset_transfer_method: String,
    pub price_atomic: Option<i64>,
    pub public_base_url: String,
    pub admin_token: String,
    pub facilitator_timeout_secs: u64,
    pub log_level: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let port = env_parse("X402_PORT", DEFAULT_PORT)?;
        if port == 0 {
            bail!("X402_PORT must be between 1 and 65535");
        }

        let database_url = env_or("X402_DATABASE_URL", "sqlite:./data/ledger.db");
        if !database_url.starts_with("sqlite:") {
            bail!("X402_DATABASE_URL must use sqlite: in phase 0");
        }

        let facilitator_url =
            validate_url("X402_FACILITATOR_URL", &required("X402_FACILITATOR_URL")?)?;
        let pay_to = required("X402_PAY_TO")?.to_lowercase();
        validate_evm_address("X402_PAY_TO", &pay_to)?;

        let network = env_or("X402_NETWORK", DEFAULT_NETWORK);
        if network.trim().is_empty() {
            bail!("X402_NETWORK must not be empty");
        }

        let asset = env_or("X402_ASSET", DEFAULT_ASSET).to_lowercase();
        validate_evm_address("X402_ASSET", &asset)?;

        let asset_symbol = env_or("X402_ASSET_SYMBOL", "USDC");
        if asset_symbol.trim().is_empty() {
            bail!("X402_ASSET_SYMBOL must not be empty");
        }
        let asset_decimals = env_parse("X402_ASSET_DECIMALS", 6u8)?;
        if asset_decimals > 18 {
            bail!("X402_ASSET_DECIMALS must be between 0 and 18");
        }
        let asset_name = env_or("X402_ASSET_NAME", &asset_symbol);
        let asset_version = env_or("X402_ASSET_VERSION", "2");
        let asset_transfer_method = env_or("X402_ASSET_TRANSFER_METHOD", "eip3009").to_lowercase();
        match asset_transfer_method.as_str() {
            "eip3009" | "permit2" => {}
            _ => bail!("X402_ASSET_TRANSFER_METHOD must be eip3009 or permit2"),
        }

        let price_atomic = env_parse_optional::<i64>("X402_PRICE_ATOMIC")?
            .or(env_parse_optional::<i64>("X402_PRICE_MICROUSDC")?);
        if let Some(price) = price_atomic {
            if price <= 0 {
                bail!("X402_PRICE_MICROUSDC must be positive");
            }
        }

        let public_base_url = validate_url(
            "X402_PUBLIC_BASE_URL",
            &env_or("X402_PUBLIC_BASE_URL", DEFAULT_PUBLIC_BASE_URL),
        )?;

        let admin_token = required("X402_ADMIN_TOKEN")?;
        require_ascii("X402_ADMIN_TOKEN", &admin_token)?;
        if admin_token.len() < 8 {
            bail!("X402_ADMIN_TOKEN must be at least 8 characters");
        }

        let facilitator_timeout_secs = env_parse(
            "X402_FACILITATOR_TIMEOUT_SECONDS",
            DEFAULT_FACILITATOR_TIMEOUT_SECS,
        )?;
        if facilitator_timeout_secs == 0 {
            bail!("X402_FACILITATOR_TIMEOUT_SECONDS must be positive");
        }

        let log_level = env_or("X402_LOG_LEVEL", "info").to_lowercase();
        match log_level.as_str() {
            "debug" | "info" | "warn" | "error" => {}
            _ => bail!("X402_LOG_LEVEL must be debug, info, warn, or error"),
        }

        Ok(Self {
            port,
            database_url,
            facilitator_url,
            pay_to,
            network,
            asset,
            asset_symbol,
            asset_decimals,
            asset_name,
            asset_version,
            asset_transfer_method,
            price_atomic,
            public_base_url,
            admin_token,
            facilitator_timeout_secs,
            log_level,
        })
    }
}

fn env_or(key: &str, fallback: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn required(key: &str) -> Result<String> {
    match env::var(key) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => bail!("{key} is required"),
    }
}

fn env_parse<T>(key: &str, fallback: T) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(key) {
        Ok(raw) if !raw.is_empty() => raw.parse().map_err(|err| anyhow::anyhow!("{key}: {err}")),
        _ => Ok(fallback),
    }
}

fn env_parse_optional<T>(key: &str) -> Result<Option<T>>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(key) {
        Ok(raw) if !raw.is_empty() => raw
            .parse()
            .map(Some)
            .map_err(|err| anyhow::anyhow!("{key}: {err}")),
        _ => Ok(None),
    }
}

fn validate_evm_address(key: &str, value: &str) -> Result<()> {
    let valid = value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        bail!("{key} must be a 0x-prefixed 20-byte address");
    }
    Ok(())
}

fn require_ascii(key: &str, value: &str) -> Result<()> {
    if value.bytes().any(|byte| !(0x20..=0x7e).contains(&byte)) {
        bail!("{key} must contain visible ASCII only");
    }
    Ok(())
}

fn validate_url(key: &str, raw: &str) -> Result<String> {
    let trimmed = raw.trim_end_matches('/');
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        bail!("{key} must use http or https");
    }
    let host = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or_default();
    if host.is_empty() || host.starts_with('/') {
        bail!("{key} must include a host");
    }
    Ok(trimmed.to_string())
}
