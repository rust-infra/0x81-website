import { getUser, type AdminUserDetail } from "@/api/admin";
import { ArrowLeftOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Descriptions,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

function formatTime(value: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—";
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const result = await getUser(id);
      setDetail(result);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户详情失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const deckColumns: ColumnsType<AdminUserDetail["deck_summaries"][number]> = [
    { title: "卡组名称", dataIndex: "name", key: "name" },
    {
      title: "卡片数",
      dataIndex: "card_count",
      key: "card_count",
      width: 100,
    },
    {
      title: "类型",
      dataIndex: "is_system",
      key: "is_system",
      width: 100,
      render: (isSystem: boolean) =>
        isSystem ? <Tag color="blue">系统</Tag> : <Tag>用户</Tag>,
    },
  ];

  const user = detail?.user;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/users")}
        >
          返回列表
        </Button>
        <Typography.Title level={3} style={{ margin: 0 }}>
          用户详情
        </Typography.Title>
      </Space>

      <Card title="基本信息" loading={loading} style={{ marginBottom: 16 }}>
        {user ? (
          <Descriptions column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="ID">{user.id}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
            <Descriptions.Item label="姓名">{user.name}</Descriptions.Item>
            <Descriptions.Item label="登录方式">
              {user.provider}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {user.status === "active" ? (
                <Tag color="green">启用</Tag>
              ) : (
                <Tag color="red">禁用</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="角色">
              {user.role === "admin" ? (
                <Tag color="purple">管理员</Tag>
              ) : (
                <Tag>用户</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="注册时间">
              {formatTime(user.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="最近登录">
              {formatTime(user.last_login_at)}
            </Descriptions.Item>
            <Descriptions.Item label="最近同步">
              {formatTime(user.last_sync_at)}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Card>

      <Card title="卡组摘要" loading={loading} style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={deckColumns}
          dataSource={detail?.deck_summaries ?? []}
          pagination={false}
          locale={{ emptyText: "暂无卡组" }}
        />
      </Card>

      <Card title="同步摘要" loading={loading}>
        <Descriptions column={1}>
          <Descriptions.Item label="最近同步时间">
            {formatTime(detail?.sync_summary.last_sync_at ?? null)}
          </Descriptions.Item>
          <Descriptions.Item label="近期同步次数">
            {detail?.sync_summary.recent_sync_count ?? 0}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
