import { useAdminAuth } from "@/auth/AdminAuthContext";
import {
  BookOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Typography } from "antd";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

const menuItems = [
  {
    key: "/decks",
    icon: <BookOutlined />,
    label: "词库管理",
  },
  {
    key: "/users",
    icon: <UserOutlined />,
    label: "用户管理",
  },
];

export default function AdminLayout() {
  const { token, logout } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const handleLock = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={0}>
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          墨言 Admin
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 24,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Typography.Text strong>管理控制台</Typography.Text>
          <Button icon={<LockOutlined />} onClick={handleLock}>
            锁定
          </Button>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
