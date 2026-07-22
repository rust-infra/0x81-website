import { useAdminAuth } from "@/auth/AdminAuthContext";
import {
  BookOutlined,
  CloudDownloadOutlined,
  ImportOutlined,
  LockOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Typography } from "antd";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

const menuItems = [
  {
    key: "/decks",
    icon: <BookOutlined />,
    label: "系统卡组",
  },
  {
    key: "/import",
    icon: <ImportOutlined />,
    label: "导入导出",
  },
  {
    key: "/collect",
    icon: <CloudDownloadOutlined />,
    label: "数据采集",
  },
  {
    key: "/settings",
    icon: <SettingOutlined />,
    label: "设置",
  },
  {
    key: "/users",
    icon: <UserOutlined />,
    label: "用户管理",
  },
];

function selectedMenuKey(pathname: string): string {
  if (pathname.startsWith("/decks")) {
    return "/decks";
  }
  if (pathname.startsWith("/import")) {
    return "/import";
  }
  if (pathname.startsWith("/collect")) {
    return "/collect";
  }
  if (pathname.startsWith("/settings")) {
    return "/settings";
  }
  if (pathname.startsWith("/users")) {
    return "/users";
  }
  return pathname;
}

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
          selectedKeys={[selectedMenuKey(location.pathname)]}
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
