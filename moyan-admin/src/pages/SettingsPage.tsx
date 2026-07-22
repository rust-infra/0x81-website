import {
  getLlmSettings,
  updateLlmSettings,
  type LlmSettings,
  type UpdateLlmSettingsInput,
} from "@/api/admin";
import { Button, Card, Form, Input, InputNumber, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [form] = Form.useForm<UpdateLlmSettingsInput>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LlmSettings | null>(null);

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
  }, []);

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
