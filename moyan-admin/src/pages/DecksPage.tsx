import {
  createDeck,
  deleteDeck,
  listDecks,
  updateDeck,
  type Deck,
} from "@/api/admin";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface DeckFormValues {
  name: string;
  description?: string;
  color?: string;
  source_key?: string;
  is_active: boolean;
  sort_order?: number;
}

const PAGE_SIZE = 20;

export default function DecksPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<DeckFormValues>();
  const [items, setItems] = useState<Deck[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDecks = useCallback(async (q: string, currentPage: number) => {
    setLoading(true);
    try {
      const result = await listDecks({
        q: q || undefined,
        page: currentPage,
        page_size: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载词库失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDecks(search, page);
  }, [loadDecks, search, page]);

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
    setEditingDeck(null);
    form.setFieldsValue({
      name: "",
      description: "",
      color: "#1677ff",
      source_key: "",
      is_active: true,
      sort_order: 0,
    });
    setModalOpen(true);
  };

  const openEditModal = (deck: Deck) => {
    setEditingDeck(deck);
    form.setFieldsValue({
      name: deck.name,
      description: deck.description,
      color: deck.color ?? "#1677ff",
      source_key: deck.source_key ?? "",
      is_active: deck.is_active,
      sort_order: deck.sort_order,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const payload = {
        name: values.name,
        description: values.description || undefined,
        color: values.color || undefined,
        source_key: values.source_key || undefined,
        is_active: values.is_active,
        sort_order: values.sort_order,
      };

      if (editingDeck) {
        await updateDeck(editingDeck.id, payload);
        message.success("词库已更新");
      } else {
        await createDeck(payload);
        message.success("词库已创建");
      }

      setModalOpen(false);
      void loadDecks(search, page);
    } catch (err) {
      if (err instanceof Error && err.message) {
        message.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (deckId: string) => {
    try {
      await deleteDeck(deckId);
      message.success("词库已删除");
      void loadDecks(search, page);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const columns: ColumnsType<Deck> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) => (
        <Space>
          {record.color ? (
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 2,
                background: record.color,
              }}
            />
          ) : null}
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: "source_key",
      dataIndex: "source_key",
      key: "source_key",
      render: (value: string | null) => value ?? "—",
    },
    {
      title: "卡片数",
      dataIndex: "card_count",
      key: "card_count",
      width: 90,
    },
    {
      title: "排序",
      dataIndex: "sort_order",
      key: "sort_order",
      width: 80,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      key: "is_active",
      width: 90,
      render: (active: boolean) =>
        active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<UnorderedListOutlined />}
            onClick={() => navigate(`/decks/${record.id}/cards`)}
          >
            卡片
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该词库？"
            description="关联卡片将一并删除"
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
          系统卡组
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建词库
        </Button>
      </Space>

      <Input.Search
        placeholder="搜索词库名称或 source_key"
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
        title={editingDeck ? "编辑词库" : "新建词库"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="color" label="颜色">
            <ColorPicker
              showText
              onChange={(_, hex) => form.setFieldValue("color", hex)}
            />
          </Form.Item>
          <Form.Item name="source_key" label="source_key">
            <Input placeholder="可选，系统词库标识" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
