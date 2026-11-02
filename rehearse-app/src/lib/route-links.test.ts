import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * 路由字符串写错时 expo-router 只在运行时给一屏「Unmatched Route」。
 * 这个测试把「源码里写死的跳转目标」与「src/app 下真实存在的路由」对上，
 * 让写错的路径在 `npm test` 阶段就失败。
 *
 * 背景：`/rehearse/interview` 是改名前的旧路径（§7.9 把 `coach/interview/*`
 * 改成了 `coach/material/*`），两处入口一直指着一个不存在的页面。
 */

const ROOT = process.cwd();
const APP_DIR = join(ROOT, 'src/app');
const SRC_DIR = join(ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** `src/app/(tabs)/history.tsx` → `/history`；`index` 与 `_layout` 按 expo-router 的规则处理。 */
function routeOf(file: string): string | null {
  const rel = relative(APP_DIR, file).split(sep).join('/').replace(/\.tsx$/, '');
  if (rel.endsWith('_layout')) return null;
  const segments = rel.split('/').filter((s) => s && !s.startsWith('(') && s !== 'index');
  return '/' + segments.join('/');
}

function segmentsOf(path: string): string[] {
  return path
    .split(/[?#]/)[0]
    .split('/')
    .filter((s) => s && !s.startsWith('('));
}

function matches(route: string, target: string): boolean {
  const routeSegs = segmentsOf(route);
  const targetSegs = segmentsOf(target);
  if (routeSegs.length !== targetSegs.length) return false;
  return routeSegs.every((seg, i) => seg.startsWith('[') || seg === targetSegs[i]);
}

const NAV_PATTERNS = [
  /router\.(?:push|replace)\(\s*'([^']+)'/g,
  /pathname:\s*'([^']+)'/g,
];

test('every literal navigation target resolves to a route under src/app', () => {
  const routes = walk(APP_DIR)
    .map(routeOf)
    .filter((route): route is string => route !== null);
  assert.ok(routes.length > 5, `路由表看起来不对：${routes.join(', ')}`);

  const broken: string[] = [];
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of NAV_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const target = match[1];
        if (!target.startsWith('/')) continue;
        if (!routes.some((route) => matches(route, target))) {
          broken.push(`${relative(ROOT, file)} → ${target}`);
        }
      }
    }
  }

  assert.deepEqual(broken, [], `这些跳转目标没有对应的页面：\n${broken.join('\n')}`);
});
