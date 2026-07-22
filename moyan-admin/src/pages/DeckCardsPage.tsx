import {
  createCard,
  deleteCard,
  listCards,
  updateCard,
  type Card,
  type CardExampleInput,
} from "@/api/admin";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { serialColumn } from "@/utils/tableColumns";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface CardFormValues {
  front: string;
  back: string;
  pronunciation?: string;
  tags?: string[];
  examples?: CardExampleInput[];
}

const PAGE_SIZE = 20;

function formatExamples(examples: Card["examples"] | undefined): string {
  if (!examples?.length) {
    return "—";
  }
  return examples
    .map((ex) => {
      const en = ex.sentence_en?.trim() ?? "";
      const zh = ex.translation_zh?.trim() ?? "";
      if (en && zh) return `${en} / ${zh}`;
      return en || zh;
    })
    .filter(Boolean)
    .join(" · ");
}

export default function DeckCardsPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm<CardFormValues>();
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCards = useCallback(
    async (q: string, currentPage: number) => {
      if (!deckId) {
        return;
      }

      setLoading(true);
      try {
        const result = await listCards(deckId, {
          q: q || undefined,
          page: currentPage,
          page_size: PAGE_SIZE,
        });
        setItems(result.items);
        setTotal(result.total);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "加载卡片失败");
      } finally {
        setLoading(false);
      }
    },
    [deckId],
  );

  useEffect(() => {
    void loadCards(search, page);
  }, [loadCards, search, page]);

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setSearch(value.trim());
    }, 300);
  };

  const openCreateModal = () => {
    setEditingCard(null);
    form.setFieldsValue({
      front: "",
      back: "",
      pronunciation: "",
      tags: [],
      examples: [{ sentence_en: "", translation_zh: "" }],
    });
    setModalOpen(true);
  };

  const openEditModal = (card: Card) => {
    setEditingCard(card);
    form.setFieldsValue({
      front: card.front,
      back: card.back,
      pronunciation: card.pronunciation ?? "",
      tags: card.tags,
      examples: card.examples?.length
        ? card.examples.map((ex) => ({
            id: ex.id,
            sentence_en: ex.sentence_en,
            translation_zh: ex.translation_zh,
          }))
        : [{ sentence_en: "", translation_zh: "" }],
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!deckId) {
      return;
    }

    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const examples = (values.examples ?? [])
        .map((ex) => ({
          id: ex.id,
          sentence_en: ex.sentence_en?.trim() ?? "",
          translation_zh: ex.translation_zh?.trim() ?? "",
        }))
        .filter((ex) => ex.sentence_en || ex.translation_zh);

      const payload = {
        front: values.front,
        back: values.back,
        pronunciation: values.pronunciation || undefined,
        tags: values.tags,
        examples,
      };

      if (editingCard) {
        await updateCard(editingCard.id, payload);
        message.success("卡片已更新");
      } else {
        await createCard(deckId, payload);
        message.success("卡片已创建");
      }

      setModalOpen(false);
      void loadCards(search, page);
    } catch (err) {
      if (err instanceof Error && err.message) {
        message.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (cardId: string) => {
    try {
      await deleteCard(cardId);
      message.success("卡片已删除");
      void loadCards(search, page);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const columns: ColumnsType<Card> = [
    serialColumn<Card>({ page, pageSize: PAGE_SIZE }),
    {
      title: "正面",
      dataIndex: "front",
      key: "front",
      width: 160,
    },
    {
      title: "背面",
      dataIndex: "back",
      key: "back",
      width: 180,
      ellipsis: true,
    },
    {
      title: "发音",
      dataIndex: "pronunciation",
      key: "pronunciation",
      width: 140,
      render: (value: string | null) => value ?? "—",
    },
    {
      title: "例句",
      key: "examples",
      ellipsis: true,
      render: (_: unknown, record) => formatExamples(record.examples),
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      width: 160,
      render: (tags: string[]) =>
        tags.length > 0 ? (
          <Space size={[0, 4]} wrap>
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ) : (
          "—"
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该卡片？"
            onConfirm={() => void handleDelete(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (!deckId) {
    return null;
  }

  return (
    <div>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/decks")}
          >
            返回
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            卡片管理
          </Typography.Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建卡片
        </Button>
      </Space>

      <Input.Search
        placeholder="搜索正面、背面或发音"
        allowClear
        onChange={(e) => handleSearchChange(e.target.value)}
        onSearch={(value) => {
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
          }
          setPage(1);
          setSearch(value.trim());
        }}
        style={{ marginBottom: 16, maxWidth: 360 }}
      />

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

      <Modal
        title={editingCard ? "编辑卡片" : "新建卡片"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="front"
            label="正面"
            rules={[{ required: true, message: "请输入正面内容" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="back"
            label="背面"
            rules={[{ required: true, message: "请输入背面内容" }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="pronunciation" label="发音">
            <Input placeholder="/ˈæp.əl/" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="输入后回车添加标签" />
          </Form.Item>
          <Form.List name="examples">
            {(fields, { add, remove }) => (
              <div>
                <Space
                  style={{
                    width: "100%",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <Typography.Text>例句</Typography.Text>
                  <Button type="dashed" size="small" onClick={() => add()}>
                    添加例句
                  </Button>
                </Space>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="start"
                    style={{ display: "flex", marginBottom: 8 }}
                  >
                    <Form.Item
                      {...field}
                      name={[field.name, "sentence_en"]}
                      style={{ marginBottom: 0, width: 240 }}
                    >
                      <Input placeholder="英文例句" />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "translation_zh"]}
                      style={{ marginBottom: 0, width: 240 }}
                    >
                      <Input placeholder="中文翻译" />
                    </Form.Item>
                    <Form.Item name={[field.name, "id"]} hidden>
                      <Input />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
