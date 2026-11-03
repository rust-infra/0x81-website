import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { file, serve } from "bun";

const root = resolve(join(import.meta.dir, "dist"));
const port = Number(process.env.PORT ?? 4322);

async function resolveFile(pathname: string) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    // 非法百分号编码（例如 /%E0%A4%A）不能让 fetch 直接抛错。
    return null;
  }

  const candidates = [
    rel,
    join(rel, "index.html"),
    rel.endsWith(".html") ? rel : `${rel}.html`,
  ];

  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    // 目录穿越：../、绝对路径、编码后的分隔符都在 resolve 之后检查。
    if (path !== root && !path.startsWith(root + sep)) continue;
    try {
      // exists() 对目录也为真；只接受真正的文件，否则 / 和 /zh/ 会
      // 命中 dist 目录而不是 index.html。
      if ((await stat(path)).isFile()) return file(path);
    } catch {
      // 不存在 / 无权限：试下一个候选
    }
  }

  return null;
}

serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const entry = await resolveFile(new URL(req.url).pathname);
    if (entry) {
      return new Response(entry);
    }

    return new Response("Not Found", { status: 404 });
  },
});
