import {
  collectYoutubeImport,
  copyCollectJob,
  deleteCollectJob,
  getCollectJob,
  listDecks,
  pauseCollectJob,
  type CollectJob,
  type Deck,
} from "@/api/admin";
import {
  POLL_MS,
  draftRowsFromJob,
  formatDuration,
  isRunningStatus,
  llmProgressFromJob,
  pipelineWithLlmProgress,
  statusColor,
  statusLabel,
  type PreviewRow,
} from "@/pages/collect/collectShared";
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
} from "@ant-design/icons";
import {
  Button,
  Input,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { serialColumn } from "@/utils/tableColumns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function CollectJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<CollectJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(50);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [targetMode, setTargetMode] = useState<"create" | "merge">("create");
  const [deckName, setDeckName] = useState("");
  const [mergeDeckId, setMergeDeckId] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    void listDecks({ page: 1, page_size: 100 })
      .then((pageResult) => setDecks(pageResult.items))
      .catch(() => undefined);
  }, []);

  const loadJob = useCallback(async () => {
    if (!jobId) {
      return;
    }
    try {
      const next = await getCollectJob(jobId);
      setJob(next);
      if (next.status === "ready") {
        setDeckName((prev) => prev || next.title || "");
        // Keep in-progress edits across poll refreshes.
        setRows((prev) => (prev.length > 0 ? prev : draftRowsFromJob(next)));
      } else {
        setRows([]);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "任务详情加载失败");
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    void loadJob();
    const timer = window.setInterval(() => {
      void loadJob();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadJob]);

  useEffect(() => {
    if (job?.status !== "extracting") {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job?.status]);

  const handlePause = async () => {
    if (!jobId) return;
    try {
      await pauseCollectJob(jobId);
      message.success("已请求暂停");
      await loadJob();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "暂停失败");
    }
  };

  const handleCopy = async () => {
    if (!jobId) return;
    try {
      const created = await copyCollectJob(jobId);
      message.success("已复制为新任务");
      navigate(`/collect/${created.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "复制失败");
    }
  };

  const handleDelete = async () => {
    if (!jobId) return;
    try {
      await deleteCollectJob(jobId);
      message.success("已删除");
      navigate("/collect");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleImport = async () => {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      message.error("请至少勾选一张卡片");
      return;
    }
    if (targetMode === "create" && !deckName.trim()) {
      message.error("请填写新建卡组名称");
      return;
    }
    if (targetMode === "merge" && !mergeDeckId) {
      message.error("请选择目标卡组");
      return;
    }

    setImporting(true);
    try {
      const result = await collectYoutubeImport({
        target:
          targetMode === "create"
            ? {
                mode: "create",
                name: deckName.trim(),
                description: job?.source_url
                  ? `From YouTube ${job.source_url}`
                  : undefined,
                source_key: job?.video_id
                  ? `yt_${job.video_id}_${Date.now()}`
                  : undefined,
              }
            : { mode: "merge", deck_id: mergeDeckId! },
        cards: selected.map(({ selected: _s, key: _k, ...card }) => card),
      });
      message.success(
        `导入完成：新建 ${result.created_cards}，跳过 ${result.skipped_cards}`,
      );
      navigate(`/decks/${result.deck_id}/cards`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const previewColumns: ColumnsType<PreviewRow> = useMemo(
    () => [
      serialColumn<PreviewRow>({
        page: previewPage,
        pageSize: previewPageSize,
      }),
      {
        title: "选",
        dataIndex: "selected",
        width: 56,
        render: (_: boolean, record) => (
          <input
            type="checkbox"
            checked={record.selected}
            onChange={(e) => {
              const checked = e.target.checked;
              setRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, selected: checked } : row,
                ),
              );
            }}
          />
        ),
      },
      {
        title: "正面",
        dataIndex: "front",
        render: (value: string, record) => (
          <Input
            value={value}
            onChange={(e) => {
              const front = e.target.value;
              setRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, front } : row,
                ),
              );
            }}
          />
        ),
      },
      {
        title: "背面",
        dataIndex: "back",
        render: (value: string, record) => (
          <Input
            value={value}
            onChange={(e) => {
              const back = e.target.value;
              setRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, back } : row,
                ),
              );
            }}
          />
        ),
      },
      {
        title: "发音",
        dataIndex: "pronunciation",
        width: 160,
        render: (value: string | null | undefined, record) => (
          <Input
            value={value ?? ""}
            onChange={(e) => {
              const pronunciation = e.target.value || null;
              setRows((prev) =>
                prev.map((row) =>
                  row.key === record.key ? { ...row, pronunciation } : row,
                ),
              );
            }}
          />
        ),
      },
      {
        title: "例句",
        key: "examples",
        ellipsis: true,
        render: (_: unknown, record) =>
          record.examples?.length
            ? record.examples
                .map((ex) => ex.sentence_en)
                .filter(Boolean)
                .join(" / ")
            : "—",
      },
    ],
    [previewPage, previewPageSize],
  );

  if (!jobId) {
    return null;
  }

  if (!loading && !job) {
    return (
      <div>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/collect")}
          style={{ marginBottom: 16 }}
        >
          返回列表
        </Button>
        <Typography.Paragraph type="secondary">任务不存在或已删除</Typography.Paragraph>
      </div>
    );
  }

  const llmProgress = job ? llmProgressFromJob(job, nowMs) : null;
  const pipeline = job
    ? pipelineWithLlmProgress(job.status, llmProgress)
    : null;

  return (
    <div>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
        wrap
      >
        <Space wrap>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/collect")}
          >
            返回列表
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            任务详情
          </Typography.Title>
          {job ? (
            <Tag color={statusColor(job.status)}>{statusLabel(job.status)}</Tag>
          ) : null}
        </Space>
        {job ? (
          <Space>
            <Button
              icon={<PauseCircleOutlined />}
              disabled={!isRunningStatus(job.status)}
              onClick={() => void handlePause()}
            >
              暂停
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => void handleCopy()}>
              复制为新任务
            </Button>
            <Popconfirm
              title="确定删除该任务？"
              onConfirm={() => void handleDelete()}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : null}
      </Space>

      {job ? (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {job.title
              ? `${job.title}（${job.video_id || "—"}）`
              : job.url}
          </Typography.Paragraph>
          <Typography.Paragraph
            type="secondary"
            copyable={{ text: job.id }}
            style={{ fontSize: 12 }}
          >
            {job.id}
          </Typography.Paragraph>
          {pipeline ? (
            <Steps
              size="small"
              current={pipeline.current}
              items={pipeline.items}
              style={{ maxWidth: 720, marginBottom: 16 }}
            />
          ) : null}
          {llmProgress ? (
            <div
              style={{
                maxWidth: 720,
                marginBottom: 16,
                padding: "12px 16px",
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 8,
              }}
            >
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                LLM 整理进度
              </Typography.Text>
              <Progress
                percent={llmProgress.percent}
                status={
                  job.status === "failed"
                    ? "exception"
                    : llmProgress.active
                      ? "active"
                      : "success"
                }
                format={() =>
                  llmProgress.chunkTotal > 0
                    ? `${llmProgress.chunkDone}/${llmProgress.chunkTotal}`
                    : `${llmProgress.percent}%`
                }
              />
              <Space size="large" wrap style={{ marginTop: 8 }}>
                <Statistic
                  title="字幕分段"
                  value={
                    llmProgress.chunkTotal > 0
                      ? llmProgress.active
                        ? `正在处理第 ${Math.min(
                            llmProgress.chunkDone + 1,
                            llmProgress.chunkTotal,
                          )} / ${llmProgress.chunkTotal} 段`
                        : `已完成 ${llmProgress.chunkDone}/${llmProgress.chunkTotal} 段`
                      : llmProgress.active
                        ? "准备中…"
                        : "—"
                  }
                  valueStyle={{ fontSize: 16 }}
                />
                <Statistic
                  title={llmProgress.active ? "已提取词汇" : "词汇总量"}
                  value={llmProgress.cardCount}
                  suffix="个"
                  valueStyle={{ fontSize: 16 }}
                />
                <Statistic
                  title={llmProgress.active ? "LLM 已耗时" : "LLM 总耗时"}
                  value={
                    llmProgress.elapsedMs != null
                      ? formatDuration(llmProgress.elapsedMs)
                      : "—"
                  }
                  valueStyle={{ fontSize: 16 }}
                />
                {llmProgress.active && llmProgress.etaMs != null ? (
                  <Statistic
                    title="预计剩余"
                    value={formatDuration(llmProgress.etaMs)}
                    valueStyle={{ fontSize: 16 }}
                  />
                ) : null}
              </Space>
              <Typography.Paragraph
                type="secondary"
                style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}
              >
                按字幕分段调用 LLM（非逐词）；进度每约 2 秒刷新，耗时每秒更新。
              </Typography.Paragraph>
            </div>
          ) : null}
          {job.error ? (
            <Typography.Paragraph type="danger">{job.error}</Typography.Paragraph>
          ) : null}
          {isRunningStatus(job.status) && !llmProgress?.active ? (
            <Typography.Paragraph type="secondary">
              任务进行中，页面会自动刷新进度…
            </Typography.Paragraph>
          ) : null}
        </>
      ) : (
        <Typography.Paragraph type="secondary">加载中…</Typography.Paragraph>
      )}

      {rows.length > 0 ? (
        <>
          <Typography.Title level={5}>预览导入</Typography.Title>
          <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
            <Radio.Group
              value={targetMode}
              onChange={(e) => setTargetMode(e.target.value)}
            >
              <Radio value="create">新建卡组</Radio>
              <Radio value="merge">合并到已有卡组</Radio>
            </Radio.Group>
            {targetMode === "create" ? (
              <Input
                style={{ maxWidth: 480 }}
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="卡组名称"
              />
            ) : (
              <Select
                style={{ maxWidth: 480 }}
                placeholder="选择系统卡组"
                value={mergeDeckId}
                onChange={setMergeDeckId}
                options={decks.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </Space>

          <Table
            rowKey="key"
            columns={previewColumns}
            dataSource={rows}
            pagination={{
              current: previewPage,
              pageSize: previewPageSize,
              showSizeChanger: true,
              showTotal: (count) => `共 ${count} 条`,
              onChange: (nextPage, nextSize) => {
                setPreviewPage(nextPage);
                setPreviewPageSize(nextSize);
              },
            }}
            size="small"
            style={{ marginBottom: 16 }}
            scroll={{ x: 900 }}
          />

          <Button
            type="primary"
            loading={importing}
            onClick={() => void handleImport()}
          >
            确认导入（已选 {rows.filter((r) => r.selected).length}）
          </Button>
        </>
      ) : null}

      {job?.status === "ready" && rows.length === 0 ? (
        <Typography.Paragraph type="secondary">
          该任务已完成，但没有候选卡片。
        </Typography.Paragraph>
      ) : null}
    </div>
  );
}
