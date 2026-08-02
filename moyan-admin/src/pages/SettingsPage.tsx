import {
  getLlmSettings,
  getPodcastConfig,
  updateLlmSettings,
  updatePodcastConfig,
  type LlmSettings,
  type PodcastConfig,
  type UpdateLlmSettingsInput,
} from "@/api/admin";
import {
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [podcast, setPodcast] = useState<PodcastConfig | null>(null);
  const [podcastEnabled, setPodcastEnabled] = useState(false);
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
  }, []);

  const loadPodcast = async () => {
    try {
      const data = await getPodcastConfig();
      setPodcast(data);
      setPodcastEnabled(data.enabled);
      setPodcastKey("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载播客配置失败");
    }
  };

  const handleSavePodcast = async () => {
    try {
      setPodcastSaving(true);
      const data = await updatePodcastConfig({
        enabled: podcastEnabled === true,
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
      message.success("LLM 设置已保存");
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
      message.success("已清除 API Key");
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
          {podcast?.enabled && !podcast.youtube_api_key && (
            <Typography.Text type="warning">
              已开启但未配置 Key，移动端搜索将不可用
            </Typography.Text>
          )}
        </Space>
      </Card>
      <Typography.Paragraph type="secondary">
        配置 OpenAI 兼容接口（base_url / api_key / model），供数据采集页调用。
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
    </div>
  );
}
