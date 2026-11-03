#!/usr/bin/env node
// Expo 的 **SPA 导出不会读取 `app/+html.tsx`**（那个文件只在 static / server
// rendering 下生效），所以 Telegram SDK 和 viewport 在这里注入。
//
// 这一步同时用于本地验证和 Dockerfile.web，保证两条路径产出的 index.html
// 完全一致。脚本是幂等的：重复执行不会插两遍。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'dist/index.html');
let html = await readFile(target, 'utf8');

const viewport = /<meta name="viewport" content="[^"]*"\s*\/>/;
if (!viewport.test(html)) {
  throw new Error(`patch-web-html: viewport meta not found in ${target}`);
}
html = html.replace(
  viewport,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
);

if (!html.includes('telegram-web-app.js')) {
  if (!html.includes('</head>')) {
    throw new Error(`patch-web-html: </head> not found in ${target}`);
  }
  html = html.replace(
    '</head>',
    '  <script src="https://telegram.org/js/telegram-web-app.js"></script>\n</head>'
  );
}

await writeFile(target, html);
console.log(`patched ${target}: Telegram SDK + viewport-fit=cover`);
