import { pingAdmin } from "@/api/admin";
import { useAdminAuth } from "@/auth/AdminAuthContext";
import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

type LoginFormValues = {
  token: string;
};

export default function LoginPage() {
  const { token, login } = useAdminAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token) {
    return <Navigate to="/decks" replace />;
  }

  const onFinish = async (values: LoginFormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      await pingAdmin(values.token.trim());
      login(values.token.trim());
      navigate("/decks", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: "100%", maxWidth: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          墨言管理后台
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          输入 ADMIN_TOKEN 解锁管理控制台
        </Typography.Paragraph>

        {error ? (
          <Alert
            type="error"
            message={error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item
            name="token"
            label="管理员令牌"
            rules={[{ required: true, message: "请输入管理员令牌" }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="ADMIN_TOKEN"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              解锁
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
