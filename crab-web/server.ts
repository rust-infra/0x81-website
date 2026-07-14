import { join } from "node:path";
import { file, serve } from "bun";

const root = join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 4322);

async function resolveFile(pathname: string) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = [
    rel,
    join(rel, "index.html"),
    rel.endsWith(".html") ? rel : `${rel}.html`,
  ].map((entry) => join(root, entry));

  for (const path of candidates) {
    const entry = file(path);
    if (await entry.exists()) {
      return entry;
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
