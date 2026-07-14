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
    url: "http://tact.0x81.uk",
    codeLines: [
      "export const product = {",
      "  id: 'tact',",
      "  status: 'live',",
      "  stack: 'rust · mcp · terminal',",
      "  url: 'http://tact.0x81.uk',",
      "}",
    ],
  },
  {
    id: "crab",
    status: "live",
    stack: "rust · responses · proxy",
    fileName: "crab.ts",
    url: "http://crab.0x81.uk",
    codeLines: [
      "export const product = {",
      "  id: 'crab',",
      "  status: 'live',",
      "  stack: 'rust · responses · proxy',",
      "  url: 'http://crab.0x81.uk',",
      "}",
    ],
  },
];
