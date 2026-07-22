import {
  copyCollectJob,
  createCollectJob,
  deleteCollectJob,
  listCollectJobs,
  pauseCollectJob,
  type CollectJobListItem,
} from "@/api/admin";
import {
  DEFAULT_PROXY,
  POLL_MS,
  PROXY_ENABLED_KEY,
  PROXY_STORAGE_KEY,
  isRunningStatus,
  loadProxyEnabled,
  loadProxyUrl,
  statusColor,
  statusLabel,
} from "@/pages/collect/collectShared";
import {
  CopyOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { serialColumn } from "@/utils/tableColumns";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function CollectJobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<CollectJobListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [listLoading, setListLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState(
    "https://www.youtube.com/watch?v=LqG1q5NpOBE",
  );
  const [proxyEnabled, setProxyEnabled] = useState(loadProxyEnabled);
  const [proxyUrl, setProxyUrl] = useState(loadProxyUrl);
  const [submitting, setSubmitting] = useState(false);

  const refreshJobs = useCallback(async () => {
    setListLoading(true);
    try {
      const result = await listCollectJobs({
        q: q || undefined,
        status: statusFilter,
        page,
        page_size: pageSize,
      });
      setJobs(result.items);
      setTotal(result.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "任务列表加载失败");
    } finally {
      setListLoading(false);
    }
  }, [q, statusFilter, page, pageSize]);

  useEffect(() => {
    sessionStorage.setItem(PROXY_ENABLED_KEY, proxyEnabled ? "1" : "0");
  }, [proxyEnabled]);

  useEffect(() => {
    sessionStorage.setItem(PROXY_STORAGE_KEY, proxyUrl);
  }, [proxyUrl]);

  useEffect(() => {
    void refreshJobs();
    const timer = window.setInterval(() => {
      void refreshJobs();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  const handleCreate = async () => {
    if (!url.trim()) {
      message.error("请输入 YouTube 链接");
      return;
    }
    if (proxyEnabled && !proxyUrl.trim()) {
      message.error("已启用代理，请填写代理地址");
      return;
    }
    setSubmitting(true);
    try {
      const job = await createCollectJob({
        url: url.trim(),
        proxy: proxyEnabled ? proxyUrl.trim() : undefined,
      });
      message.success("已创建采集任务");
      setCreateOpen(false);
      setPage(1);
      await refreshJobs();
      navigate(`/collect/${job.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async (id: string) => {
    try {
      await pauseCollectJob(id);
      message.success("已请求暂停");
      await refreshJobs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "暂停失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCollectJob(id);
      message.success("已删除");
      await refreshJobs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleCopy = async (id: string) => {
    try {
      const job = await copyCollectJob(id);
      message.success("已复制为新任务");
      setPage(1);
      await refreshJobs();
      navigate(`/collect/${job.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "复制失败");
    }
  };

  const columns: ColumnsType<CollectJobListItem> = [
    serialColumn<CollectJobListItem>({ page, pageSize }),
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (status: string) => (
        <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>
      ),
    },
    {
      title: "标题 / URL",
      key: "title",
      ellipsis: true,
      render: (_: unknown, record) => (
        <div>
          <div>{record.title || "—"}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.url}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "候选",
      dataIndex: "draft_card_count",
      width: 72,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 180,
      render: (v: string) => v.replace("T", " ").slice(0, 19),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="link"
            onClick={() => navigate(`/collect/${record.id}`)}
          >
            打开
          </Button>
          <Button
            size="small"
            icon={<PauseCircleOutlined />}
            disabled={!isRunningStatus(record.status)}
            onClick={() => void handlePause(record.id)}
          />
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => void handleCopy(record.id)}
          />
          <Popconfirm
            title="确定删除该任务？"
            onConfirm={() => void handleDelete(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          数据采集
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshJobs()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新建任务
          </Button>
        </Space>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="检索 URL / 标题 / video_id / id"
          style={{ width: 320 }}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onSearch={(value) => {
            setPage(1);
            setQ(value.trim());
          }}
        />
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 160 }}
          value={statusFilter}
          onChange={(value) => {
            setPage(1);
            setStatusFilter(value);
          }}
          options={[
            { value: "queued", label: "排队中" },
            { value: "fetching_captions", label: "拉取字幕" },
            { value: "extracting", label: "LLM 整理" },
            { value: "ready", label: "已完成" },
            { value: "failed", label: "失败" },
            { value: "paused", label: "已暂停" },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={listLoading}
        columns={columns}
        dataSource={jobs}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (next) => setPage(next),
          showTotal: (t) => `共 ${t} 条`,
        }}
        onRow={(record) => ({
          onDoubleClick: () => navigate(`/collect/${record.id}`),
          style: { cursor: "pointer" },
        })}
      />

      <Drawer
        title="新建采集任务"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={480}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={submitting}
            onClick={() => void handleCreate()}
          >
            提交
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="YouTube 链接" required>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={submitting}
            />
          </Form.Item>
          <Form.Item
            label="网络代理"
            extra="访问 YouTube / LLM 不通时开启"
          >
            <Space align="center" wrap>
              <Switch
                checked={proxyEnabled}
                onChange={setProxyEnabled}
                disabled={submitting}
                checkedChildren="开"
                unCheckedChildren="关"
              />
              <Input
                style={{ width: 280 }}
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder={DEFAULT_PROXY}
                disabled={submitting || !proxyEnabled}
              />
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
