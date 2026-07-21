import {
  exportVocabularyExcel,
  exportVocabularyJson,
  downloadVocabularyTemplate,
  importVocabulary,
  ImportValidationError,
  type ImportErrorItem,
  type ImportMode,
  type ImportResult,
} from "@/api/admin";
import {
  DownloadOutlined,
  ExportOutlined,
  FileExcelOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Modal,
  Radio,
  Space,
  Table,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useState } from "react";

const errorColumns: ColumnsType<ImportErrorItem> = [
  { title: "工作表", dataIndex: "sheet", key: "sheet", width: 120 },
  { title: "行", dataIndex: "row", key: "row", width: 70 },
  { title: "字段", dataIndex: "field", key: "field", width: 120 },
  { title: "说明", dataIndex: "message", key: "message" },
];

export default function ImportExportPage() {
  const [mode, setMode] = useState<ImportMode>("merge");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<ImportErrorItem[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runDownload = async (
    key: string,
    action: () => Promise<void>,
    successMessage: string,
  ) => {
    setDownloading(key);
    try {
      await action();
      message.success(successMessage);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };

  const performImport = async (file: File) => {
    setImporting(true);
    setImportErrors([]);
    setImportResult(null);

    try {
      const result = await importVocabulary(file, mode);
      setImportResult(result);
      setFileList([]);
      message.success("导入成功");
    } catch (err) {
      if (err instanceof ImportValidationError) {
        setImportErrors(err.errors);
        message.error("导入失败，请修正 Excel 后重试");
      } else {
        message.error(err instanceof Error ? err.message : "导入失败");
      }
    } finally {
      setImporting(false);
    }
  };

  const handleImportClick = () => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning("请先选择 Excel 文件");
      return;
    }

    if (mode === "replace_deck") {
      setConfirmOpen(true);
      return;
    }

    void performImport(file);
  };

  const handleConfirmImport = () => {
    const file = fileList[0]?.originFileObj;
    setConfirmOpen(false);
    if (file) {
      void performImport(file);
    }
  };

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        导入导出
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        下载模版、导出系统词库，或通过 Excel 批量导入。
      </Typography.Paragraph>

      <Card title="导出" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            icon={<DownloadOutlined />}
            loading={downloading === "template"}
            onClick={() =>
              void runDownload(
                "template",
                downloadVocabularyTemplate,
                "模版已下载",
              )
            }
          >
            下载模版
          </Button>
          <Button
            icon={<FileExcelOutlined />}
            loading={downloading === "excel"}
            onClick={() =>
              void runDownload(
                "excel",
                exportVocabularyExcel,
                "Excel 已导出",
              )
            }
          >
            导出 Excel
          </Button>
          <Button
            icon={<ExportOutlined />}
            loading={downloading === "json"}
            onClick={() =>
              void runDownload("json", exportVocabularyJson, "JSON 已导出")
            }
          >
            导出 JSON
          </Button>
        </Space>
      </Card>

      <Card title="导入">
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Typography.Text strong style={{ marginRight: 12 }}>
              导入模式
            </Typography.Text>
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
            >
              <Radio value="merge">合并（merge）</Radio>
              <Radio value="replace_deck">替换卡组（replace_deck）</Radio>
            </Radio.Group>
          </div>

          <Upload
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            maxCount={1}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: nextList }) => setFileList(nextList)}
          >
            <Button icon={<UploadOutlined />}>选择 Excel 文件</Button>
          </Upload>

          <Button
            type="primary"
            loading={importing}
            onClick={handleImportClick}
          >
            开始导入
          </Button>

          {importResult ? (
            <Alert
              type="success"
              showIcon
              message="导入完成"
              description={
                <Space direction="vertical" size={0}>
                  <span>新建卡组：{importResult.created_decks}</span>
                  <span>更新卡组：{importResult.updated_decks}</span>
                  <span>新建卡片：{importResult.created_cards}</span>
                  <span>更新卡片：{importResult.updated_cards}</span>
                </Space>
              }
            />
          ) : null}

          {importErrors.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`导入失败（${importErrors.length} 条错误）`}
              description={
                <Table
                  rowKey={(record) =>
                    `${record.sheet}-${record.row}-${record.field}`
                  }
                  size="small"
                  columns={errorColumns}
                  dataSource={importErrors}
                  pagination={false}
                  style={{ marginTop: 12 }}
                />
              }
            />
          ) : null}
        </Space>
      </Card>

      <Modal
        title="确认替换卡组导入"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={handleConfirmImport}
        okText="确认导入"
        okButtonProps={{ danger: true }}
      >
        <Typography.Paragraph>
          replace_deck 会对 Excel 中出现的卡组：更新元数据后清空该卡组全部卡片，再按文件全量写入；未出现在文件中的卡组不会改动。此操作不可撤销。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          请确认已备份当前词库后再继续。
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
