export type ProductStatus = "live" | "soon";

export interface Product {
  id: string;
  status: ProductStatus;
  stack: string;
  fileName: string;
  url?: string;
  codeLines: string[];
}

export const products: Product[] = [
  {
    id: "tact",
    status: "live",
    stack: "rust · mcp · terminal",
    fileName: "tact.tsx",
    url: "https://tact.0x81.uk",
    codeLines: [
      "export const product = {",
      "  id: 'tact',",
      "  status: 'live',",
      "  stack: 'rust · mcp · terminal',",
      "  url: 'https://tact.0x81.uk',",
      "}",
    ],
  },
  {
    id: "crab",
    status: "live",
    stack: "rust · responses · proxy",
    fileName: "crab.ts",
    url: "https://crab.0x81.uk",
    codeLines: [
      "export const product = {",
      "  id: 'crab',",
      "  status: 'live',",
      "  stack: 'rust · responses · proxy',",
      "  url: 'https://crab.0x81.uk',",
      "}",
    ],
  },
  {
    // 只做 App、没有 Web 前端（设计稿 §3.3），所以这里没有 url：
    // 公开入口要等 App 上架。翻成 live 时再补 url（商店页或落地页）。
    id: "rehearse",
    status: "soon",
    stack: "go · expo · voice",
    fileName: "rehearse.go",
    codeLines: [
      "export const product = {",
      "  id: 'rehearse',",
      "  status: 'soon',",
      "  stack: 'go · expo · voice',",
      "  surface: 'app-only',",
      "}",
    ],
  },
];
