//! 每日用量配额：读取管理端设置、按 UTC+8 划分自然日、原子消费一次额度。

use std::sync::Arc;

use chrono::{DateTime, FixedOffset, TimeZone, Utc};

use crate::middleware::error::AppError;
use crate::repositories::Repository;

pub const COACH_SETTING_KEY: &str = "coach";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CoachSettings {
    #[serde(default = "default_daily_turn_limit")]
    pub daily_turn_limit: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_daily_turn_limit() -> u32 {
    100
}

fn default_enabled() -> bool {
    true
}

impl Default for CoachSettings {
    fn default() -> Self {
        Self {
            daily_turn_limit: default_daily_turn_limit(),
            enabled: default_enabled(),
        }
    }
}

fn offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("UTC+8 is a valid offset")
}

/// 该时刻所属的 UTC+8 自然日，格式 `YYYY-MM-DD`。
pub fn day_key(now: DateTime<Utc>) -> String {
    now.with_timezone(&offset()).format("%Y-%m-%d").to_string()
}

/// 下一个 UTC+8 零点。
pub fn resets_at(now: DateTime<Utc>) -> DateTime<FixedOffset> {
    let local = now.with_timezone(&offset());
    let tomorrow = local.date_naive().succ_opt().expect("date overflow");
    let naive = tomorrow.and_hms_opt(0, 0, 0).expect("valid midnight");
    // 关键：naive 表示的是「本地零点」，不是 UTC。用 from_naive_utc_and_offset 会
    // 把本地零点当成 UTC，结果偏移整整 8 小时（测试 day_key_uses_utc_plus_eight 抓到）。
    offset()
        .from_local_datetime(&naive)
        .single()
        .expect("UTC+8 has no DST, midnight is unambiguous")
}

/// 返回 `Some(limit)` 表示已用尽；`None` 表示仍可用。
pub fn would_exceed(settings: &CoachSettings, used: u32) -> Option<u32> {
    if !settings.enabled || settings.daily_turn_limit == 0 {
        return None;
    }
    if used >= settings.daily_turn_limit {
        Some(settings.daily_turn_limit)
    } else {
        None
    }
}

#[derive(Clone)]
pub struct CoachQuotaService {
    repository: Arc<dyn Repository>,
}

impl CoachQuotaService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn settings(&self) -> Result<CoachSettings, AppError> {
        if let Some(raw) = self.repository.admin_get_setting(COACH_SETTING_KEY).await? {
            if let Ok(parsed) = serde_json::from_str::<CoachSettings>(&raw) {
                return Ok(parsed);
            }
        }
        Ok(CoachSettings::default())
    }

    /// `(limit, used, resets_at RFC3339)`
    pub async fn snapshot(&self, user_id: &str) -> Result<(u32, u32, String), AppError> {
        let settings = self.settings().await?;
        let now = Utc::now();
        let used = self.repository.coach_usage_get(user_id, &day_key(now)).await?;
        Ok((settings.daily_turn_limit, used, resets_at(now).to_rfc3339()))
    }

    /// 检查并在有额度时消费一次；超限返回 `AppError::QuotaExceeded`。
    pub async fn check_and_consume(&self, user_id: &str) -> Result<(), AppError> {
        let settings = self.settings().await?;
        let now = Utc::now();
        let day = day_key(now);
        let used = self.repository.coach_usage_get(user_id, &day).await?;
        if let Some(limit) = would_exceed(&settings, used) {
            return Err(AppError::QuotaExceeded {
                limit,
                used,
                resets_at: resets_at(now).to_rfc3339(),
            });
        }
        self.repository.coach_usage_increment(user_id, &day).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_key_uses_utc_plus_eight() {
        // 2026-09-27T17:00:00Z == 2026-09-28 01:00 +08:00
        let utc = chrono::DateTime::parse_from_rfc3339("2026-09-27T17:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(day_key(utc), "2026-09-28");
        assert_eq!(
            resets_at(utc),
            chrono::DateTime::parse_from_rfc3339("2026-09-29T00:00:00+08:00").unwrap()
        );
    }

    #[test]
    fn day_key_before_midnight_stays_on_same_day() {
        let utc = chrono::DateTime::parse_from_rfc3339("2026-09-27T15:59:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(day_key(utc), "2026-09-27");
    }

    #[test]
    fn zero_limit_means_unlimited() {
        let settings = CoachSettings { daily_turn_limit: 0, enabled: true };
        assert!(would_exceed(&settings, 999_999).is_none());
    }

    #[test]
    fn exceeded_when_enabled_and_at_limit() {
        let settings = CoachSettings { daily_turn_limit: 100, enabled: true };
        assert!(would_exceed(&settings, 99).is_none());
        assert_eq!(would_exceed(&settings, 100), Some(100));
    }

    #[test]
    fn disabled_means_unlimited() {
        let settings = CoachSettings { daily_turn_limit: 100, enabled: false };
        assert!(would_exceed(&settings, 100).is_none());
    }
}
