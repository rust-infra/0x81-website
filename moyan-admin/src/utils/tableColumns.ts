import type { ColumnType } from "antd/es/table";

/** 列表自动序号列。服务端/受控分页传入 page + pageSize；无分页可省略。 */
export function serialColumn<T>(options?: {
  page?: number;
  pageSize?: number;
}): ColumnType<T> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize;
  return {
    title: "#",
    key: "__serial",
    width: 56,
    align: "center",
    render: (_: unknown, __: T, index: number) =>
      pageSize != null ? (page - 1) * pageSize + index + 1 : index + 1,
  };
}
