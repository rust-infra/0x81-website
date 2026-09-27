//! 管理端「AI 陪练」设置：每日用量上限，存 `admin_settings` 键 `coach`。

use std::sync::Arc;

use crate::middleware::error::AppError;
use crate::repositories::Repository;
use crate::services::coach_quota::{CoachSettings, COACH_SETTING_KEY};

pub const MAX_DAILY_TURN_LIMIT: u32 = 100_000;

pub fn clamp_settings(input: CoachSettings) -> CoachSettings {
    CoachSettings {
        daily_turn_limit: input.daily_turn_limit.min(MAX_DAILY_TURN_LIMIT),
        enabled: input.enabled,
    }
}

#[derive(Clone)]
pub struct CoachSettingsService {
    repository: Arc<dyn Repository>,
}

impl CoachSettingsService {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        Self { repository }
    }

    pub async fn get(&self) -> Result<CoachSettings, AppError> {
        if let Some(raw) = self.repository.admin_get_setting(COACH_SETTING_KEY).await? {
            if let Ok(parsed) = serde_json::from_str::<CoachSettings>(&raw) {
                return Ok(clamp_settings(parsed));
            }
        }
        Ok(CoachSettings::default())
    }

    pub async fn update(&self, input: CoachSettings) -> Result<CoachSettings, AppError> {
        let settings = clamp_settings(input);
        let value = serde_json::to_string(&settings)
            .map_err(|e| AppError::Internal(format!("serialize coach settings: {e}")))?;
        self.repository
            .admin_put_setting(COACH_SETTING_KEY, &value)
            .await?;
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_limit_into_range() {
        assert_eq!(
            clamp_settings(CoachSettings { daily_turn_limit: 999_999, enabled: true })
                .daily_turn_limit,
            100_000
        );
        assert_eq!(
            clamp_settings(CoachSettings { daily_turn_limit: 0, enabled: true }).daily_turn_limit,
            0
        );
        assert!(!clamp_settings(CoachSettings { daily_turn_limit: 100, enabled: false }).enabled);
    }
}
