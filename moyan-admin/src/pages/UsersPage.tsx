import {
  listUsers,
  patchUser,
  type AdminUser,
} from "@/api/admin";
import { EyeOutlined } from "@ant-design/icons";
import {
  Button,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const PAGE_SIZE = 20;

function formatTime(value: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";
}

export default function UsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminUser["status"] | "">(
    "",
  );
  const [roleFilter, setRoleFilter] = useState<AdminUser["role"] | "">("");
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listUsers({
        q: search || undefined,
        page,
        page_size: PAGE_SIZE,
        status: statusFilter || undefined,
        role: roleFilter || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, search, statusFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setSearch(value.trim());
    }, 300);
  };

  const updateUser = async (
    userId: string,
    input: Parameters<typeof patchUser>[1],
  ) => {
    setUpdatingId(userId);
    try {
      const updated = await patchUser(userId, input);
      setItems((prev) =>
        prev.map((item) => (item.id === userId ? updated : item)),
      );
      message.success("用户已更新");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setUpdatingId(null);
    }
  };

  const columns: ColumnsType<AdminUser> = [
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      render: (email: string, record) => (
        <Link to={`/users/${record.id}`}>{email}</Link>
      ),
    },
    {
      title: "姓名",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "登录方式",
      dataIndex: "provider",
      key: "provider",
      width: 110,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: AdminUser["status"], record) => (
        <Switch
          checked={status === "active"}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          loading={updatingId === record.id}
          onChange={(checked) =>
            void updateUser(record.id, {
              status: checked ? "active" : "disabled",
            })
          }
        />
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 120,
      render: (role: AdminUser["role"], record) => (
        <Select<AdminUser["role"]>
          value={role}
          style={{ width: 100 }}
          disabled={updatingId === record.id}
          options={[
            { value: "user", label: "用户" },
            { value: "admin", label: "管理员" },
          ]}
          onChange={(nextRole) =>
            void updateUser(record.id, { role: nextRole })
          }
        />
      ),
    },
    {
      title: "注册时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 160,
      render: (value: string) => formatTime(value),
    },
    {
      title: "最近登录",
      dataIndex: "last_login_at",
      key: "last_login_at",
      width: 160,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: "最近同步",
      dataIndex: "last_sync_at",
      key: "last_sync_at",
      width: 160,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_, record) => (
        <Link to={`/users/${record.id}`}>
          <Button type="link" size="small" icon={<EyeOutlined />}>
            详情
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        用户管理
      </Typography.Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索邮箱、姓名或 ID"
          allowClear
          onChange={(e) => handleSearchChange(e.target.value)}
          onSearch={(value) => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
            }
            setPage(1);
            setSearch(value.trim());
          }}
          style={{ width: 280 }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          value={statusFilter || undefined}
          options={[
            { value: "active", label: "启用" },
            { value: "disabled", label: "禁用" },
          ]}
          onChange={(value) => {
            setPage(1);
            setStatusFilter(value ?? "");
          }}
        />
        <Select
          allowClear
          placeholder="角色"
          style={{ width: 120 }}
          value={roleFilter || undefined}
          options={[
            { value: "user", label: "用户" },
            { value: "admin", label: "管理员" },
          ]}
          onChange={(value) => {
            setPage(1);
            setRoleFilter(value ?? "");
          }}
        />
        {statusFilter || roleFilter ? (
          <Tag>
            筛选：
            {statusFilter ? `状态=${statusFilter}` : null}
            {statusFilter && roleFilter ? " · " : null}
            {roleFilter ? `角色=${roleFilter}` : null}
          </Tag>
        ) : null}
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (count) => `共 ${count} 条`,
          onChange: (nextPage) => setPage(nextPage),
        }}
      />
    </div>
  );
}
