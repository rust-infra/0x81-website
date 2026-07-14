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
    id: "nova",
    status: "soon",
    stack: "inference gateway",
    fileName: "nova.ts",
    codeLines: [
      "export const product = {",
      "  id: 'nova',",
      "  status: 'incubating',",
      "  stack: 'inference gateway',",
      "}",
    ],
  },
  {
    id: "orbit",
    status: "soon",
    stack: "evals & traces",
    fileName: "orbit.ts",
    codeLines: [
      "export const product = {",
      "  id: 'orbit',",
      "  status: 'incubating',",
      "  stack: 'evals & traces',",
      "}",
    ],
  },
];
