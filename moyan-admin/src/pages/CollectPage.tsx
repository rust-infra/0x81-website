import {
  collectYoutubeCaptions,
  collectYoutubeExtract,
  collectYoutubeImport,
  listDecks,
  type Deck,
  type DraftCard,
  type YoutubeCaptionsResult,
} from "@/api/admin";
import {
  CheckCircleOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import {
  Button,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type StepStatus = "wait" | "process" | "finish" | "error";

type PreviewRow = DraftCard & { key: string; selected: boolean };

const PROXY_STORAGE_KEY = "moyan_admin_collect_proxy";
const PROXY_ENABLED_KEY = "moyan_admin_collect_proxy_enabled";
const DEFAULT_PROXY = "http://127.0.0.1:7890";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function loadProxyEnabled(): boolean {
  const raw = sessionStorage.getItem(PROXY_ENABLED_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

function loadProxyUrl(): string {
  return sessionStorage.getItem(PROXY_STORAGE_KEY) || DEFAULT_PROXY;
}

export default function CollectPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(
    "https://www.youtube.com/watch?v=LqG1q5NpOBE",
  );
  const [proxyEnabled, setProxyEnabled] = useState(loadProxyEnabled);
  const [proxyUrl, setProxyUrl] = useState(loadProxyUrl);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [captions, setCaptions] = useState<YoutubeCaptionsResult | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [targetMode, setTargetMode] = useState<"create" | "merge">("create");
  const [deckName, setDeckName] = useState("");
  const [mergeDeckId, setMergeDeckId] = useState<string>();
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>([
    "wait",
    "wait",
    "wait",
    "wait",
  ]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    void listDecks({ page: 1, page_size: 100 })
      .then((page) => setDecks(page.items))
      .catch(() => undefined);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    sessionStorage.setItem(PROXY_ENABLED_KEY, proxyEnabled ? "1" : "0");
  }, [proxyEnabled]);

  useEffect(() => {
    sessionStorage.setItem(PROXY_STORAGE_KEY, proxyUrl);
  }, [proxyUrl]);

  const activeProxy = proxyEnabled ? proxyUrl.trim() : "";

  const startTimer = () => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs(Date.now() - startedAtRef.current);
  };

  const setStep = (index: number, status: StepStatus) => {
    setStepStatuses((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  };

  const handleCollect = async () => {
    if (!url.trim()) {
      message.error("请输入 YouTube 链接");
      return;
    }
    if (proxyEnabled && !proxyUrl.trim()) {
      message.error("已启用代理，请填写代理地址");
      return;
    }
    setRunning(true);
    setCaptions(null);
    setRows([]);
    setStepStatuses(["process", "wait", "wait", "wait"]);
    startTimer();

    try {
      setStep(0, "finish");
      setStep(1, "process");
      const captionResult = await collectYoutubeCaptions(
        url.trim(),
        activeProxy || undefined,
      );
      setCaptions(captionResult);
      setDeckName(captionResult.title);
      setStep(1, "finish");
      setStep(2, "process");

      const extractResult = await collectYoutubeExtract({
        video_id: captionResult.video_id,
        title: captionResult.title,
        caption_text: captionResult.caption_text,
        proxy: activeProxy || undefined,
      });
      setRows(
        extractResult.draft_cards.map((card, index) => ({
          ...card,
          key: `${card.front}-${index}`,
          selected: true,
          tags: card.tags?.length
            ? card.tags
            : ["youtube", captionResult.video_id],
          examples: card.examples ?? [],
        })),
      );
      setStep(2, "finish");
      setStep(3, "finish");
      if (extractResult.truncated) {
        message.warning("字幕过长，已截断后送入 LLM");
      }
      message.success(`已生成 ${extractResult.draft_cards.length} 条候选词汇`);
    } catch (err) {
      setStepStatuses((prev) => {
        const next = [...prev];
        const idx = next.findIndex((s) => s === "process");
        if (idx >= 0) {
          next[idx] = "error";
        }
        return next;
      });
      message.error(err instanceof Error ? err.message : "采集失败");
    } finally {
      stopTimer();
      setRunning(false);
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
                description: captions
                  ? `From YouTube ${captions.source_url}`
                  : undefined,
                source_key: captions ? `yt_${captions.video_id}` : undefined,
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

  const columns: ColumnsType<PreviewRow> = useMemo(
    () => [
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
        width: 140,
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
    [],
  );

  const stepItems = [
    { title: "解析链接", status: stepStatuses[0] },
    { title: "拉取字幕", status: stepStatuses[1] },
    { title: "LLM 整理", status: stepStatuses[2] },
    { title: "候选就绪", status: stepStatuses[3] },
  ];

  return (
    <div>
      <Space
        style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          数据采集
        </Typography.Title>
        <Typography.Text type="secondary">
          采集耗时 {formatElapsed(elapsedMs)}
          {running ? <LoadingOutlined style={{ marginLeft: 8 }} /> : null}
          {!running && stepStatuses[3] === "finish" ? (
            <CheckCircleOutlined style={{ marginLeft: 8, color: "#52c41a" }} />
          ) : null}
        </Typography.Text>
      </Space>

      <Form layout="vertical" style={{ maxWidth: 720, marginBottom: 24 }}>
        <Form.Item label="YouTube 链接" required>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={running}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={running}
              onClick={() => void handleCollect()}
            >
              开始采集
            </Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item
          label="网络代理"
          extra="访问 YouTube / LLM 不通时开启，例如 http://127.0.0.1:7890"
        >
          <Space align="center" wrap>
            <Switch
              checked={proxyEnabled}
              onChange={setProxyEnabled}
              disabled={running}
              checkedChildren="开"
              unCheckedChildren="关"
            />
            <Input
              style={{ width: 320 }}
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder={DEFAULT_PROXY}
              disabled={running || !proxyEnabled}
            />
          </Space>
        </Form.Item>
      </Form>

      <Steps
        size="small"
        items={stepItems.map((item) => ({
          title: item.title,
          status: item.status,
        }))}
        style={{ marginBottom: 24, maxWidth: 720 }}
      />

      {captions ? (
        <Typography.Paragraph type="secondary">
          视频：{captions.title}（{captions.video_id} / 字幕语言 {captions.language}
          ）
        </Typography.Paragraph>
      ) : null}

      {rows.length > 0 ? (
        <>
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
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
            style={{ marginBottom: 16 }}
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
    </div>
  );
}
