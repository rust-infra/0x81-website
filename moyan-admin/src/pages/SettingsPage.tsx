import {
  getCoachSettings,
  getLlmSettings,
  getPodcastConfig,
  getRehearseSettings,
  updateCoachSettings,
  updateLlmSettings,
  updatePodcastConfig,
  updateRehearseSettings,
  type CoachSettings,
  type LlmSettings,
  type PodcastConfig,
  type RehearseSettings,
  type UpdateLlmSettingsInput,
  type UpdateRehearseSettingsInput,
} from "@/api/admin";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [form] = Form.useForm<UpdateLlmSettingsInput>();
  const [coachForm] = Form.useForm<CoachSettings>();
  const [rehearseForm] = Form.useForm<UpdateRehearseSettingsInput>();
  const [coachSaving, setCoachSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [rehearse, setRehearse] = useState<RehearseSettings | null>(null);
  const [rehearseSaving, setRehearseSaving] = useState(false);
  const [podcast, setPodcast] = useState<PodcastConfig | null>(null);
  const [podcastEnabled, setPodcastEnabled] = useState(false);
  const [podcastWebEnabled, setPodcastWebEnabled] = useState(false);
  const [podcastKey, setPodcastKey] = useState("");
  const [podcastSaving, setPodcastSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getLlmSettings();
      setSettings(data);
      form.setFieldsValue({
        base_url: data.base_url,
        model: data.model,
        temperature: data.temperature,
        api_key: "",
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载设置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadPodcast();
    void loadCoach();
    void loadRehearse();
  }, []);

  const loadPodcast = async () => {
    try {
      const data = await getPodcastConfig();
      setPodcast(data);
      setPodcastEnabled(data.app_enabled);
      setPodcastWebEnabled(data.web_enabled);
      setPodcastKey("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载播客配置失败");
    }
  };

  const handleSavePodcast = async () => {
    try {
      setPodcastSaving(true);
      const data = await updatePodcastConfig({
        app_enabled: podcastEnabled === true,
        web_enabled: podcastWebEnabled === true,
        ...(podcastKey.trim() ? { youtube_api_key: podcastKey.trim() } : {}),
      });
      setPodcast(data);
      setPodcastKey("");
      message.success("播客配置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPodcastSaving(false);
    }
  };

  const loadCoach = async () => {
    try {
      const data = await getCoachSettings();
      coachForm.setFieldsValue(data);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "读取 AI 陪练设置失败");
    }
  };

  const handleSaveCoach = async (values: CoachSettings) => {
    setCoachSaving(true);
    try {
      const saved = await updateCoachSettings(values);
      coachForm.setFieldsValue(saved);
      message.success("AI 陪练设置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存 AI 陪练设置失败");
    } finally {
      setCoachSaving(false);
    }
  };

  const loadRehearse = async () => {
    try {
      const data = await getRehearseSettings();
      setRehearse(data);
      rehearseForm.setFieldsValue({
        daily_turn_limit: data.daily_turn_limit,
        enabled: data.enabled,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "读取职演设置失败");
    }
  };

  const handleSaveRehearse = async () => {
    setRehearseSaving(true);
    try {
      const values = await rehearseForm.validateFields();
      // 只提交配额两项：base_url / model / key 由上面的 LLM 表单统一维护，
      // 这里再放一份就成了「同一件事两个入口」。
      const saved = await updateRehearseSettings({
        daily_turn_limit: values.daily_turn_limit,
        enabled: values.enabled,
      });
      setRehearse(saved);
      message.success("职演配额已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存职演配额失败");
    } finally {
      setRehearseSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: UpdateLlmSettingsInput = {
        base_url: values.base_url,
        model: values.model,
        temperature: values.temperature,
      };
      if (values.api_key?.trim()) {
        payload.api_key = values.api_key.trim();
      }
      const data = await updateLlmSettings(payload);
      setSettings(data);
      form.setFieldValue("api_key", "");

      // 双写职演（设计稿 §7.3.2：一处编辑、双写）。
      // 职演那份失败**不回滚**墨言——两个库本来就是各管各的——但必须点名
      // 是哪一边失败，否则用户会以为整次保存都没生效。
      try {
        const saved = await updateRehearseSettings({
          base_url: payload.base_url,
          model: payload.model,
          temperature: payload.temperature,
          ...(payload.api_key ? { api_key: payload.api_key } : {}),
        });
        setRehearse(saved);
        message.success("LLM 设置已保存（墨言 + 职演）");
      } catch (err) {
        message.warning(
          `墨言已保存，但职演写入失败：${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        message.error(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    try {
      const data = await updateLlmSettings({ clear_api_key: true });
      setSettings(data);
      try {
        const saved = await updateRehearseSettings({ clear_api_key: true });
        setRehearse(saved);
        message.success("已清除 API Key（墨言 + 职演）");
      } catch (err) {
        message.warning(
          `墨言已清除，但职演清除失败：${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "清除失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Typography.Title level={3}>设置</Typography.Title>
      <Card
        title="播客"
        style={{ maxWidth: 640, marginBottom: 16 }}
        extra={
          <Button
            type="primary"
            loading={podcastSaving}
            onClick={() => void handleSavePodcast()}
          >
            保存播客配置
          </Button>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space align="center">
            <span>移动端显示播客入口</span>
            <Switch
              checked={podcastEnabled}
              onChange={setPodcastEnabled}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </Space>
          <Space align="center">
            <span>Web 端显示播客入口</span>
            <Switch
              checked={podcastWebEnabled}
              onChange={setPodcastWebEnabled}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </Space>
          <Input.Password
            placeholder={
              podcast?.youtube_api_key
                ? "已配置（留空保持不变）"
                : "输入 YouTube Data API Key"
            }
            value={podcastKey}
            onChange={(e) => setPodcastKey(e.target.value)}
            autoComplete="new-password"
          />
          {(podcast?.app_enabled || podcast?.web_enabled) && !podcast.youtube_api_key && (
            <Typography.Text type="warning">
              已开启但未配置 Key，移动端搜索将不可用
            </Typography.Text>
          )}
        </Space>
      </Card>
      <Typography.Paragraph type="secondary">
        配置 OpenAI 兼容接口（base_url / api_key / model）。**保存会同时写入墨言与职演**——
        两个服务各管各的库，但产品上只有一份配置。任一侧失败会单独提示，不会静默只写一边。
      </Typography.Paragraph>

      <Card loading={loading} style={{ maxWidth: 640 }}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="base_url"
            label="Base URL"
            rules={[{ required: true, message: "请输入 Base URL" }]}
            extra="例如 https://api.openai.com/v1"
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="model"
            label="Model"
            rules={[{ required: true, message: "请输入模型名" }]}
          >
            <Input placeholder="gpt-4o-mini" />
          </Form.Item>
          <Form.Item name="temperature" label="Temperature" initialValue={0.3}>
            <InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            extra={
              settings?.api_key_set
                ? `已配置：${settings.api_key_masked ?? "***"}（留空则不修改）`
                : "尚未配置 API Key"
            }
          >
            <Input.Password placeholder="sk-..." autoComplete="off" />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
            <Button
              danger
              disabled={!settings?.api_key_set}
              loading={saving}
              onClick={() => void handleClearKey()}
            >
              清除 Key
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="AI 陪练" style={{ maxWidth: 640, marginTop: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="每日用量上限"
          description="按用户发言轮次计。填 0 表示不限量；默认 100。超限时接口返回 429，不会调用模型。"
        />
        <Form form={coachForm} layout="vertical" onFinish={handleSaveCoach}>
          <Form.Item
            name="daily_turn_limit"
            label="每日上限（次 / 用户 / 天）"
            rules={[{ required: true, message: "请输入每日上限" }]}
          >
            <InputNumber min={0} max={100000} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用配额" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={coachSaving}>
            保存配额设置
          </Button>
        </Form>
      </Card>
      <Card title="职演（Rehearse）" style={{ maxWidth: 640, marginTop: 16 }}>
        <Alert
          type={rehearse?.api_key_set ? "success" : "warning"}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            rehearse?.api_key_set ? `LLM 已配置：${rehearse.model}` : "LLM 尚未配置"
          }
          description={
            rehearse?.api_key_set
              ? `Key ${rehearse.api_key_masked ?? "***"} · ${rehearse.base_url}。换模型或换 Key 请用上面的 LLM 表单（保存会双写到这里）。`
              : "未配置时 /api/rehearse/turn 与 /summary 会返回 503。请在上面的 LLM 表单里填 Key 并保存——保存会同时写入职演。"
          }
        />
        <Form form={rehearseForm} layout="vertical" onFinish={handleSaveRehearse}>
          <Form.Item
            name="daily_turn_limit"
            label="每日上限（轮 / 用户 / 天）"
            rules={[{ required: true, message: "请输入每日上限" }]}
          >
            <InputNumber min={0} max={100000} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用配额" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={rehearseSaving}>
            保存职演配额
          </Button>
        </Form>
      </Card>
    </div>
  );
}
