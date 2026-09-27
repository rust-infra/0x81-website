# Moyan AI 陪练 App 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Expo App 内交付原生感一致的 AI 口语陪练，覆盖文字与语音对话、场景自定义、面试模拟、本地历史、配额与降级。

**Architecture:** 后端接口已冻结；App 只持有用户 JWT，不持有 LLM Key。会话编排集中在 `useCoachSession`，页面负责展示与导航；自定义场景、历史总结和面试档案只存 AsyncStorage，原始图片/文档不落盘。语音使用设备原生 STT/TTS，头像使用 `react-native-svg` + 内置 `Animated`，不引入数字人、视频生成或第三方 UI 库。

**Tech Stack:** Expo SDK 57、React 19、React Native 0.86、expo-router、TypeScript strict、AsyncStorage、expo-speech、expo-speech-recognition、expo-image-picker、expo-image-manipulator、expo-document-picker、react-native-svg、Jest + jest-expo + React Native Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-27-moyan-ai-speaking-coach-design.md`

**Backend freeze:** `feat/ai-agent` at `27276f1`；接口测试 151/151 通过。

## Global Constraints

- v1 只做 iOS + Android App，Web 仅保证 `npx expo export --platform web` 不破坏。
- 底部 Tab 固定 5 项：首页 / 陪练 / 播客（服务端开关）/ 统计 / 设置；词库移出 Tab。
- 所有新增文案同时写 `zh-CN` 与 `en`，页面禁止硬编码中文。
- 所有颜色来自 `useTheme().theme.colors`；阴影除外。必须兼容 `xuanzhi` / `shenyemo` / `zhuqing` / `zhusha` / `dailan` / `fense` / `ios` / `ios-dark`。
- 不新增图标库；图标与头像统一 24×24 viewBox、`strokeWidth 1.8`、圆头圆角。
- 动效只使用 RN `Animated`；`AccessibilityInfo.isReduceMotionEnabled()` 为真时关闭运动。
- 不录制、不上传、不持久化音频；STT 使用 `recordingOptions.persist: false`。
- 图片压缩到长边 ≤ 1600、JPEG 质量 70、最多 5 张、单张原始字节 ≤ 1MB、合计 ≤ 4MB。
- 文档仅支持 PDF / DOCX；图片与文档只在提取阶段发送，成功后立即删除本机原文件。
- App 只提示敏感信息，不自动删除、不拦截提交。
- 每轮只调用一次 `/turn`；历史最多 40 条、总字符最多 12,000、单轮最多 2,000。
- v1 历史只回看总结，不支持断点续聊。
- 所有接口继续使用现有 Bearer JWT 与 `{ success, data }` 信封。

## Backend Contract

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/api/coach/quota` | — | `{ limit, used, remaining, resets_at, enabled, llm_configured }` |
| GET | `/api/coach/scenarios?locale=` | — | `CoachScenario[]` |
| POST | `/api/coach/scenario/draft` | `{ description, locale }` | `CoachScenario` |
| POST | `/api/coach/turn` | `CoachTurnRequest` | `CoachTurnResponse` |
| POST | `/api/coach/summary` | `CoachSummaryRequest` | `CoachSummaryResponse` |
| POST | `/api/coach/interview/text` | multipart `docs` 或 `images` | `{ text, char_count, likely_scanned, source }` |
| POST | `/api/coach/interview/profile` | `{ kind, text }` | `{ kind, profile }` |

`remaining = null` 且 `limit = 0` 表示不限量。429 错误体含 `reason: "coach_quota_exceeded"`、`limit`、`used`、`resets_at`。图片模型不支持时返回 422 `reason: "vision_not_supported"`。

## Review Focus

1. 配额/可用性接口失败时，场景页仍展示预置与本地场景，并给出可恢复错误态；不能白屏或丢失本地数据。
2. STT 权限被拒、设备不支持或原生模块异常时，键盘文字路径仍完整可用；不能把用户困在麦克风错误里。
3. 用户在 `thinking` 阶段连点提交、切后台或结束会话时，不能重复扣配额或把迟到响应写进下一次会话。
4. 材料导入混合 docs/images、扫描 PDF、超过 5 张图片、422 vision unsupported 时，分支明确且本地图片最终删除；不能把原始图片写入历史或档案。
5. 8 套主题、Reduce Motion、弱网和长文本下，关键按钮可见、字幕不遮挡、状态不卡死。

---

## Screen Map

设计稿：`moyan-app/design/coach/index.html`。实现时用 `?only=N&theme=...&state=...` 放大核对。

| # | 屏 | App 路由 / 组件 |
|---|----|-----------------|
| 1 | 首页「选择词库」入口 | `src/app/(tabs)/index.tsx` |
| 2 | 陪练 Tab · 场景选择 | `src/app/(tabs)/coach.tsx` |
| 3 | 陪练 Tab · 次数用尽 | `src/app/(tabs)/coach.tsx` |
| 4 | AI 生成场景草稿 | `src/app/coach/editor.tsx` |
| 5 | 手动编辑场景 | `src/app/coach/editor.tsx` |
| 6 | 会话 · idle/listening | `src/app/coach/session.tsx` |
| 7 | 会话 · thinking | `src/app/coach/session.tsx` |
| 8 | 会话 · speaking | `src/app/coach/session.tsx` |
| 9 | 反馈面板展开 | `src/components/coach/FeedbackPanel.tsx` |
| 10 | 本次总结 | `src/app/coach/summary.tsx` |
| 11 | 结束确认 | `src/components/coach/EndSessionSheet.tsx` |
| 12 | 历史练习 | `src/app/coach/history.tsx` |
| 13 | 陪练设置 | `src/app/coach/settings.tsx` |
| 14 | 面试入口 | `src/app/coach/interview/index.tsx` |
| 15 | 添加材料 | `src/app/coach/interview/materials.tsx` |
| 16 | 材料确认 | `src/app/coach/interview/materials.tsx` |
| 17 | 敏感信息清理提示 | `src/components/coach/SensitiveHints.tsx` |
| 18 | OCR 识别中 | `src/app/coach/interview/materials.tsx` |
| 19 | 档案预览与编辑 | `src/app/coach/interview/profile.tsx` |
| 20 | 面试会话 | `src/app/coach/session.tsx` |
| 21 | 面试复盘 | `src/app/coach/summary.tsx` |
| 22 | 扫描件 PDF 提示 | `src/app/coach/interview/materials.tsx` |
| 23 | Vision 不支持 | `src/app/coach/interview/materials.tsx` |
| 24 | 麦克风权限拒绝 | `src/components/coach/PermissionGate.tsx` |
| 25 | 陪练暂不可用 | `src/components/coach/UnavailableState.tsx` |

## File Structure

**新建**

```text
src/lib/api-error.ts                 结构化 HTTP 错误
src/lib/coach-api.ts                 陪练 API 客户端
src/lib/coach-types.ts               陪练领域类型
src/lib/navigation-contract.ts       固定 Tab 顺序的单一来源
src/lib/coach-storage.ts             AsyncStorage 仓库
src/lib/coach-session.ts             会话状态机与历史裁剪
src/lib/coach-stt.ts                 STT 权限、事件适配与降级
src/lib/coach-files.ts               图片选择、压缩、文档选择、删除
src/lib/sensitive-scan.ts            手机/邮箱/身份证疑似项扫描
src/components/coach/TabIcon.tsx      陪练 Tab 图标
src/components/coach/CoachAvatar.tsx  水墨 SVG 头像
src/components/coach/FeedbackPanel.tsx
src/components/coach/EndSessionSheet.tsx
src/components/coach/PermissionGate.tsx
src/components/coach/UnavailableState.tsx
src/components/coach/SensitiveHints.tsx
src/app/decks.tsx                     全屏词库
src/app/(tabs)/coach.tsx              场景选择 Tab 根页
src/app/coach/session.tsx
src/app/coach/summary.tsx
src/app/coach/editor.tsx
src/app/coach/history.tsx
src/app/coach/settings.tsx
src/app/coach/interview/index.tsx
src/app/coach/interview/materials.tsx
src/app/coach/interview/profile.tsx
```

**修改**

```text
package.json
app.json
src/app/_layout.tsx
src/app/(tabs)/_layout.tsx
src/app/(tabs)/index.tsx
src/components/TabIcons.tsx
src/lib/types.ts
src/lib/api.ts
src/lib/translations.ts
src/lib/speech.ts
```

**删除**

```text
src/app/(tabs)/decks.tsx              # 内容迁到 /decks
```

---

### Task 1: 测试基线、领域类型与结构化 API 错误

**Files:**
- Modify: `moyan-app/package.json`
- Create: `moyan-app/jest.config.js`
- Create: `moyan-app/jest.setup.js`
- Create: `moyan-app/src/lib/coach-types.ts`
- Create: `moyan-app/src/lib/api-error.ts`
- Modify: `moyan-app/src/lib/api.ts`
- Create: `moyan-app/src/lib/coach-api.ts`
- Test: `moyan-app/src/lib/coach-api.test.ts`

**Interfaces:**
- Produces: `ApiError { status, reason?, details?, message }`
- Produces: `CoachQuotaStatus`、`CoachScenario`、`CoachTurnRequest/Response`、`CoachSummaryRequest/Response`、`InterviewContext`
- Produces: `getCoachQuota()`、`listCoachScenarios(locale)`、`draftCoachScenario()`、`postCoachTurn()`、`postCoachSummary()`

- [ ] **Step 1: 安装测试基线并写失败测试**

Run:

```bash
cd moyan-app
npx expo install jest-expo jest @types/jest @testing-library/react-native --dev
```

`jest.setup.js`：

```js
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
```

`jest.config.js`：

```js
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|@react-navigation/.*|react-native-svg))',
  ],
};
```

测试：

```ts
import { getCoachQuota, postCoachTurn } from './coach-api';
import { ApiError } from './api-error';

describe('coach api', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('loads quota with bearer auth', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: { limit: 100, used: 4, remaining: 96, resets_at: '2026-09-28T00:00:00+08:00', enabled: true, llm_configured: true },
      }), { status: 200 })
    );
    await expect(getCoachQuota()).resolves.toMatchObject({ remaining: 96 });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/coach/quota');
  });

  it('keeps 429 details as ApiError', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        error: { code: 429, reason: 'coach_quota_exceeded', message: 'limited', limit: 2, used: 2, resets_at: '2026-09-28T00:00:00+08:00' },
      }), { status: 429 })
    );
    const err = await postCoachTurn({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, reason: 'coach_quota_exceeded', details: { limit: 2, used: 2 } });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-api.test.ts --runInBand`
Expected: FAIL，`coach-api` / `ApiError` 不存在。

- [ ] **Step 3: 实现类型与错误**

`src/lib/api-error.ts`：

```ts
export class ApiError extends Error {
  status: number;
  reason?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, reason?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.details = details;
  }
}
```

`src/lib/api.ts` 导出原 `apiRequest`，失败分支改为：

```ts
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  const error = body?.error ?? {};
  throw new ApiError(
    res.status,
    error.message || `请求失败 (${res.status})`,
    error.reason,
    error
  );
}
```

`src/lib/coach-types.ts` 按后端 JSON 精确声明，字段名保持 snake_case：

```ts
export type CoachLocale = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU' | 'zh-CN';
export type CoachTone = 'friendly' | 'neutral' | 'direct' | 'challenging';
export type CoachSetting = 'meeting' | 'one_on_one' | 'coffee_chat' | 'phone_call';
export type CoachDifficulty = 'easy' | 'core' | 'challenge';
export type CoachCategory = 'daily' | 'engineering' | 'high_stakes';
export type CoachMode = 'feedback' | 'immersion';

export interface CoachScenario {
  id: string;
  source: 'preset' | 'custom';
  category: CoachCategory;
  title: string;
  description: string;
  persona: { name: string; role: string; locale: CoachLocale; tone: CoachTone };
  setting: CoachSetting;
  opening_line: string;
  focus_points: string[];
  difficulty: CoachDifficulty;
  max_turns: number;
}

export interface CoachQuotaStatus {
  limit: number;
  used: number;
  remaining: number | null;
  resets_at: string;
  enabled: boolean;
  llm_configured: boolean;
}

export interface CoachTurn { role: 'coach' | 'user'; content: string }
export type InterviewKind = 'resume' | 'job';
export interface InterviewContext { kind: InterviewKind | 'resume_job'; profile: string }
```

- [ ] **Step 4: 实现 coach-api**

`src/lib/coach-api.ts`：

```ts
import { apiRequest } from './api';
import type { CoachQuotaStatus, CoachScenario, CoachSummaryRequest, CoachSummaryResponse, CoachTurnRequest, CoachTurnResponse } from './coach-types';

export const getCoachQuota = () => apiRequest<CoachQuotaStatus>('/api/coach/quota');
export const listCoachScenarios = (locale: string) =>
  apiRequest<CoachScenario[]>(`/api/coach/scenarios?locale=${encodeURIComponent(locale)}`);
export const draftCoachScenario = (description: string, locale: string) =>
  apiRequest<CoachScenario>('/api/coach/scenario/draft', {
    method: 'POST',
    body: JSON.stringify({ description, locale }),
  });
export const postCoachTurn = (body: CoachTurnRequest) =>
  apiRequest<CoachTurnResponse>('/api/coach/turn', { method: 'POST', body: JSON.stringify(body) });
export const postCoachSummary = (body: CoachSummaryRequest) =>
  apiRequest<CoachSummaryResponse>('/api/coach/summary', { method: 'POST', body: JSON.stringify(body) });
```

- [ ] **Step 5: 运行测试与类型检查**

Run: `cd moyan-app && npx jest src/lib/coach-api.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS；TypeScript 0 error。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/package.json moyan-app/package-lock.json moyan-app/jest.config.js moyan-app/jest.setup.js \
  moyan-app/src/lib/coach-types.ts moyan-app/src/lib/api-error.ts moyan-app/src/lib/api.ts \
  moyan-app/src/lib/coach-api.ts moyan-app/src/lib/coach-api.test.ts
git commit -m "feat(moyan-app): add coach api client and test harness"
```

---

### Task 2: 本地场景、历史与面试档案仓库

**Files:**
- Create: `moyan-app/src/lib/coach-storage.ts`
- Test: `moyan-app/src/lib/coach-storage.test.ts`

**Interfaces:**
- Produces: `loadCustomScenarios()`、`saveCustomScenario()`、`deleteCustomScenario()`
- Produces: `loadCoachHistory()`、`saveCoachHistory(record)`、`deleteCoachHistory(id)`、`clearCoachHistory()`
- Produces: `loadInterviewProfiles()`、`saveInterviewProfile()`、`deleteInterviewProfile()`
- Produces: `CoachHistoryRecord`、`InterviewProfileRecord`、`CoachPrefs`

- [ ] **Step 1: 写失败测试**

测试覆盖：CRUD、重复 id 覆盖、按更新时间倒序、删除场景不删除历史。

```ts
it('does not delete history when a custom scenario is removed', async () => {
  await saveCustomScenario(custom('s1'));
  await saveCoachHistory(history('h1', 's1'));
  await deleteCustomScenario('s1');
  expect(await loadCustomScenarios()).toEqual([]);
  expect(await loadCoachHistory()).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-storage.test.ts --runInBand`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现仓库**

使用四个 key：

```ts
const KEYS = {
  scenarios: 'coach_custom_scenarios_v1',
  history: 'coach_history_v1',
  profiles: 'coach_interview_profiles_v1',
  prefs: 'coach_prefs_v1',
} as const;
```

读函数必须对损坏 JSON 返回空数组/默认值；写函数只保存结构化档案，不保存 `rawText`、`documentUri`、`imageUri`。

- [ ] **Step 4: 运行测试**

Run: `cd moyan-app && npx jest src/lib/coach-storage.test.ts --runInBand`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add moyan-app/src/lib/coach-storage.ts moyan-app/src/lib/coach-storage.test.ts
git commit -m "feat(moyan-app): persist coach scenarios and local history"
```

---

### Task 3: 底部 Tab、全屏词库与首页入口改造

**Files:**
- Modify: `moyan-app/src/components/TabIcons.tsx`
- Modify: `moyan-app/src/app/(tabs)/_layout.tsx`
- Modify: `moyan-app/src/app/(tabs)/index.tsx`
- Create: `moyan-app/src/app/decks.tsx`
- Delete: `moyan-app/src/app/(tabs)/decks.tsx`
- Modify: `moyan-app/src/app/_layout.tsx`
- Test: `moyan-app/src/lib/navigation-contract.test.ts`

**Interfaces:**
- Produces: `TabIconName` 包含 `'coach'`
- Produces: `TAB_SCREENS` 顺序：首页 / 陪练 / 播客 / 统计 / 设置
- Consumes: Task 1/2 后续页面所需路由 `/coach/session`、`/coach/editor`

- [ ] **Step 1: 写失败测试**

```ts
import { TAB_SCREENS } from './navigation-contract';

it('keeps exactly five tabs and puts coach second', () => {
  expect(TAB_SCREENS.map((x) => x.name)).toEqual(['index', 'coach', 'podcast', 'stats', 'settings']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/navigation-contract.test.ts --runInBand`
Expected: FAIL，`TAB_SCREENS` 不存在。

- [ ] **Step 3: 实现导航契约与 Tab**

创建 `src/lib/navigation-contract.ts`：

```ts
export const TAB_SCREENS = [
  { name: 'index', titleKey: 'tabHome', icon: 'home' },
  { name: 'coach', titleKey: 'tabCoach', icon: 'coach' },
  { name: 'podcast', titleKey: 'tabPodcast', icon: 'podcast' },
  { name: 'stats', titleKey: 'tabStats', icon: 'stats' },
  { name: 'settings', titleKey: 'tabSettings', icon: 'settings' },
] as const;
```

`TabIcons.tsx` 增加 `coach` case：说话气泡 + 小脸；不要复用 podcast 麦克风。

- [ ] **Step 4: 迁词库与首页入口**

- 将 `(tabs)/decks.tsx` 内容原样迁到 `src/app/decks.tsx`，改为 Stack 全屏页，顶部左侧返回 `/`。
- `(tabs)/_layout.tsx` 删除 `decks`，新增 `coach` 第 2 项。
- 首页删除 `showPicker`、`Modal` 和对应样式；`dailyRequired` 卡片的 CTA 改为 `router.push('/decks')`。
- `_layout.tsx` 的受保护 Stack 增加 `decks`、`coach/session`、`coach/summary`、`coach/editor`、`coach/history`、`coach/settings`、`coach/interview/index`、`coach/interview/materials`、`coach/interview/profile`。

- [ ] **Step 5: 验证**

Run:

```bash
cd moyan-app
npx jest src/lib/navigation-contract.test.ts --runInBand
npx tsc --noEmit
```

Expected: PASS；首页只有 `/decks` 一个词库入口。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app moyan-app/src/components/TabIcons.tsx moyan-app/src/lib/navigation-contract.ts moyan-app/src/lib/navigation-contract.test.ts
git commit -m "feat(moyan-app): move decks out of tabs and add coach tab"
```

---

### Task 4: 场景选择页与配额状态

**Files:**
- Create: `moyan-app/src/lib/coach-selection.ts`
- Create: `moyan-app/src/app/(tabs)/coach.tsx`
- Create: `moyan-app/src/components/coach/UnavailableState.tsx`
- Test: `moyan-app/src/lib/coach-selection.test.ts`

**Interfaces:**
- Consumes: `getCoachQuota`, `listCoachScenarios`, `loadCustomScenarios`, `loadCoachHistory`
- Produces: `groupScenarios(list)`：`daily` / `engineering` / `high_stakes`
- Produces: `canStartCoach({ quota, scenario })`

- [ ] **Step 1: 写失败测试**

```ts
it('disables start when quota is exhausted but keeps scenarios visible', () => {
  const quota = { limit: 2, used: 2, remaining: 0, resets_at: 'x', enabled: true, llm_configured: true };
  expect(canStartCoach({ quota, scenario: preset })).toEqual({ ok: false, reason: 'quota' });
});

it('groups all three categories in fixed order', () => {
  expect(groupScenarios([high, daily, engineering]).map((g) => g.category))
    .toEqual(['daily', 'engineering', 'high_stakes']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-selection.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现选择页**

页面结构：

```tsx
<SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.paper }}>
  <View style={screen.header}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[screen.headerTitle, { color: c.ink }]}>{t('tabCoach')}</Text>
      <QuotaPill quota={quota} />
    </View>
  </View>
  <FlatList ... />
</SafeAreaView>
```

区块顺序固定：预置场景三组 → 我的场景 → 最近练习。预置卡片显示口音、难度、轮数；自定义卡片带编辑/删除；“新建”跳 `/coach/editor`。

- [ ] **Step 4: 接入无 LLM/禁用/配额态**

`UnavailableState` 接收 `{ kind: 'quota' | 'disabled' | 'llm' | 'network', resetsAt?: string }`：

- `llm_configured === false`：提示 `coachUnavailableLLM`
- `enabled === false`：提示 `coachDisabled`
- `remaining === 0`：提示 `coachQuotaExceeded` 与重置时间
- 网络失败：保留已加载场景，提示重试，不把页面清空

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-selection.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/lib/coach-selection.ts moyan-app/src/app/'(tabs)'/coach.tsx \
  moyan-app/src/components/coach/UnavailableState.tsx moyan-app/src/lib/coach-selection.test.ts
git commit -m "feat(moyan-app): add coach scenario selection and quota state"
```

---

### Task 5: 场景编辑器与 AI 草稿

**Files:**
- Create: `moyan-app/src/app/coach/editor.tsx`
- Create: `moyan-app/src/lib/coach-validation.ts`
- Test: `moyan-app/src/lib/coach-validation.test.ts`

**Interfaces:**
- Consumes: `draftCoachScenario`、`saveCustomScenario`
- Produces: `validateCoachScenarioDraft(input): { ok, errors, scenario? }`
- Produces: `scenarioFromTemplate(templateId): CoachScenario`

- [ ] **Step 1: 写失败测试**

覆盖 title 60、description 200、name 30、role 60、opening 200、focus 最多 5 且每项 40、max_turns clamp 3–20、未知枚举拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-validation.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现校验与模板**

模板至少四个：`incident_sync`、`scope_deadline`、`cross_timezone_handoff`、`growth_1on1`。每个模板返回完整 `CoachScenario`，`source: 'custom'`，id 使用 `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`。

- [ ] **Step 4: 实现编辑器**

三段式表单：

1. 顶部输入中文描述 + “AI 生成草稿”。
2. 模板横向选择。
3. 完整字段表单与保存。

保存时写 `coach_custom_scenarios_v1`；AI 草稿只填充表单，用户点保存后才落库。生成失败显示 `ApiError.status === 429` 的配额文案或通用重试。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-validation.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app/coach/editor.tsx moyan-app/src/lib/coach-validation.ts moyan-app/src/lib/coach-validation.test.ts
git commit -m "feat(moyan-app): add custom scenario editor and AI draft"
```

---

### Task 6: 水墨头像与状态动效

**Files:**
- Create: `moyan-app/src/components/coach/CoachAvatar.tsx`
- Test: `moyan-app/src/components/coach/CoachAvatar.test.tsx`

**Interfaces:**
- Produces: `CoachAvatar({ state, mood, size, reduceMotion? })`
- `state`: `'idle' | 'listening' | 'thinking' | 'speaking'`
- `mood`: `'neutral' | 'friendly' | 'curious' | 'encouraging' | 'concerned'`

- [ ] **Step 1: 写失败测试**

```tsx
it('renders listening ring without emoji or raster image', () => {
  const tree = render(<CoachAvatar state="listening" mood="friendly" size={180} reduceMotion />);
  expect(tree.getByTestId('coach-avatar-listening')).toBeTruthy();
  expect(tree.queryByText('🙂')).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/components/coach/CoachAvatar.test.tsx --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现 SVG**

`Svg` 画半身轮廓、眉/眼/嘴、状态波纹。动画使用 `Animated.Value`：

- idle：呼吸 `scale 1 → 1.015`
- listening：音量环由 `volume` prop 驱动
- thinking：三个墨点依次浮现
- speaking：嘴部宽度与声波幅度交替

首次挂载读取 `AccessibilityInfo.isReduceMotionEnabled()`；`reduceMotion` 为真时跳过所有 `Animated.loop`。

- [ ] **Step 4: 验证**

Run: `cd moyan-app && npx jest src/components/coach/CoachAvatar.test.tsx --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add moyan-app/src/components/coach/CoachAvatar.tsx moyan-app/src/components/coach/CoachAvatar.test.tsx
git commit -m "feat(moyan-app): add animated ink coach avatar"
```

---

### Task 7: STT 适配器与会话状态机

**Files:**
- Create: `moyan-app/src/lib/coach-stt.ts`
- Create: `moyan-app/src/lib/coach-session.ts`
- Modify: `moyan-app/app.json`
- Test: `moyan-app/src/lib/coach-session.test.ts`
- Test: `moyan-app/src/lib/coach-stt.test.ts`

**Interfaces:**
- Produces: `CoachSessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'`
- Produces: `sessionReducer(state, event)`；防止重复 submit、过期响应写入
- Produces: `startListening(locale)`、`stopListening()`、`requestMicPermissions()`
- Produces: `appendHistory(history, turn)`，提交前裁剪到 40 条 / 12,000 字符

- [ ] **Step 1: 写失败测试**

```ts
it('ignores a second submit while thinking', () => {
  let s = sessionReducer(initial, { type: 'USER_SUBMIT', id: 'a' });
  const next = sessionReducer(s, { type: 'USER_SUBMIT', id: 'b' });
  expect(next.requestId).toBe('a');
});

it('drops stale response after session reset', () => {
  const s = sessionReducer(initial, { type: 'USER_SUBMIT', id: 'a' });
  const reset = sessionReducer(s, { type: 'RESET' });
  expect(sessionReducer(reset, { type: 'TURN_SUCCESS', id: 'a' })).toEqual(reset);
});

it('falls back when microphone permission is denied', async () => {
  await expect(requestMicPermissions({ request: async () => ({ granted: false }) }))
    .resolves.toEqual({ granted: false, reason: 'denied' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-session.test.ts src/lib/coach-stt.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 安装并配置 STT**

Run: `cd moyan-app && npx expo install expo-speech-recognition`

`app.json` plugins 增加：

```json
{
  "expo-speech-recognition": {
    "microphonePermission": "墨言需要使用麦克风进行英语口语练习。",
    "speechRecognitionPermission": "墨言需要使用系统语音识别把你说的话转成文字。"
  }
}
```

- [ ] **Step 4: 实现 STT 适配器**

`startListening` 对齐 spec 参数：

```ts
ExpoSpeechRecognitionModule.start({
  lang,
  interimResults: true,
  continuous: false,
  addsPunctuation: true,
  requiresOnDeviceRecognition: false,
  volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
  iosCategory: {
    category: 'playAndRecord',
    categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
    mode: 'measurement',
  },
  recordingOptions: { persist: false },
});
```

模块不存在、权限拒绝、`start` 抛错都必须返回可展示错误，不 crash。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-session.test.ts src/lib/coach-stt.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/package.json moyan-app/package-lock.json moyan-app/app.json \
  moyan-app/src/lib/coach-stt.ts moyan-app/src/lib/coach-session.ts \
  moyan-app/src/lib/coach-session.test.ts moyan-app/src/lib/coach-stt.test.ts
git commit -m "feat(moyan-app): add native speech recognition and session state machine"
```

---

### Task 8: 会话页与反馈面板

**Files:**
- Create: `moyan-app/src/app/coach/session.tsx`
- Create: `moyan-app/src/components/coach/FeedbackPanel.tsx`
- Create: `moyan-app/src/components/coach/EndSessionSheet.tsx`
- Create: `moyan-app/src/components/coach/PermissionGate.tsx`
- Test: `moyan-app/src/components/coach/FeedbackPanel.test.tsx`

**Interfaces:**
- Consumes: Task 4 route params `{ scenarioId, source, interviewKind?, profile? }`
- Consumes: `postCoachTurn`、`speak`、`stopSpeaking`、STT adapter
- Produces: 完成会话时 `router.replace({ pathname: '/coach/summary', params: { sessionId } })`

- [ ] **Step 1: 写失败测试**

```tsx
it('auto-opens once when corrections exist and can replay a phrase', () => {
  const onSpeak = jest.fn();
  render(<FeedbackPanel feedback={feedback} onSpeak={onSpeak} />);
  expect(screen.getByText('We finished the API')).toBeTruthy();
  fireEvent.press(screen.getByText('I’m on the UI today.'));
  expect(onSpeak).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/components/coach/FeedbackPanel.test.tsx --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现会话页**

页面按会话深色 token 渲染。状态：`idle`、`listening`、`thinking`、`speaking`。关键行为：

- AI 回复完成后按 `auto_play` 调 `speak(reply, { language: scenario.persona.locale })`。
- `thinking` 时禁用麦克风与提交；屏幕底部保留“取消本轮”。
- STT final 文本可编辑后才提交；interim 只用于字幕。
- 键盘输入与语音走同一个 `submitText`。
- TTS 播放中，音量环不显示；STT 监听中显示用户音量。
- 反馈默认折叠，收到 corrections 自动展开一次。
- 退出前 `stopSpeaking()`、`stopListening()`。

- [ ] **Step 4: 错误恢复**

`ApiError` 处理：

- 429：展示重置时间，保留历史，禁用继续提交。
- 503：保留本轮文本，按钮“重试”。
- 422 vision unsupported：仅面试导入路径出现，提示改用粘贴文本。
- 其他网络错误：显示 toast，状态回 `idle`，历史不丢。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/components/coach/FeedbackPanel.test.tsx --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app/coach/session.tsx moyan-app/src/components/coach \
  moyan-app/src/app/coach/session.tsx
git commit -m "feat(moyan-app): add immersive coach session screen"
```

---

### Task 9: 总结页与历史回看

**Files:**
- Create: `moyan-app/src/app/coach/summary.tsx`
- Create: `moyan-app/src/app/coach/history.tsx`
- Test: `moyan-app/src/lib/coach-history.test.ts`

**Interfaces:**
- Consumes: `postCoachSummary`、`saveCoachHistory`、`loadCoachHistory`
- Produces: `summaryRecordFromSession(session, response): CoachHistoryRecord`
- Produces: `summaryRouteParams(record)`，history 页复用同一总结组件

- [ ] **Step 1: 写失败测试**

```ts
it('stores no chat transcript or raw interview text', () => {
  const record = summaryRecordFromSession(sessionWithSecrets, summary);
  const json = JSON.stringify(record);
  expect(json).not.toContain('13800138000');
  expect(json).not.toContain('resume raw text');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-history.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现总结页**

展示 `stats`、`strengths`、`improvements`、`expressions`；句子带朗读按钮。面试总结额外展示 `interview_feedback.star_structure`、`quantified_impact`、`weak_spots`。

按钮：

- 「再来一次」重置同场景会话。
- 「换个场景」`router.replace('/(tabs)/coach')`。
- 「保存到本地历史」调用 `saveCoachHistory`，成功后禁用以防重复写入。

- [ ] **Step 4: 历史页**

按 `updatedAt` 倒序列表；点击进入只读总结；左滑/删除按钮删除单条；设置页提供“清空历史”。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-history.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app/coach/summary.tsx moyan-app/src/app/coach/history.tsx moyan-app/src/lib/coach-history.test.ts
git commit -m "feat(moyan-app): add coach summary and local history"
```

---

### Task 10: 面试材料选择、压缩与文本提取

**Files:**
- Create: `moyan-app/src/lib/coach-files.ts`
- Create: `moyan-app/src/app/coach/interview/index.tsx`
- Create: `moyan-app/src/app/coach/interview/materials.tsx`
- Test: `moyan-app/src/lib/coach-files.test.ts`

**Interfaces:**
- Consumes: `/api/coach/interview/text`
- Produces: `pickAndCompressImages(max = 5): Promise<PreparedImage[]>`
- Produces: `pickInterviewDocuments(): Promise<PreparedDocument[]>`
- Produces: `extractInterviewText({ images, docs })`
- Produces: `InterviewDraft { kind: 'resume' | 'job'; text: string; source: 'document' | 'image' | 'paste' }`；简历必选，职位可选
- Produces: `deletePreparedFiles(items)`，无论成功失败最终都调用

- [ ] **Step 1: 写失败测试**

```ts
it('rejects more than five images before upload', async () => {
  await expect(normalizePickedImages(makeImages(6))).rejects.toThrow('max 5 images');
});

it('deletes local files even when upload fails', async () => {
  const remove = jest.fn();
  await expect(withCleanup([{ uri: 'file:///a' }], () => Promise.reject(new Error('x')), remove))
    .rejects.toThrow('x');
  expect(remove).toHaveBeenCalledWith([{ uri: 'file:///a' }]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-files.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 安装原生依赖并配置权限**

Run:

```bash
cd moyan-app
npx expo install expo-image-picker expo-image-manipulator expo-document-picker
```

`app.json` 增加：

```json
{
  "expo-image-picker": {
    "photosPermission": "墨言需要读取你选择的简历或职位图片。",
    "cameraPermission": "墨言需要使用相机拍摄简历或职位图片。"
  },
  "expo-document-picker": {}
}
```

- [ ] **Step 4: 实现文件准备**

图片统一转为 JPEG（`expo-image-manipulator` v57 新 API）：

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const context = ImageManipulator.manipulate(item.uri);
context.resize(resizeActionFor(item.width, item.height, 1600));
const rendered = await context.renderAsync();
const result = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
```

若原图长边 ≤ 1600 也统一转 JPEG。上传 multipart 字段必须是 `images` 或 `docs`：

```ts
const form = new FormData();
prepared.forEach((item, index) => {
  form.append('images', { uri: item.uri, name: `resume-${index}.jpg`, type: 'image/jpeg' } as never);
});
```

- [ ] **Step 5: 实现材料确认页**

顶部材料类型 resume/job；中间 `TextInput multiline` 显示识别文本与字数；底部“生成面试档案”；次要按钮“重新识别”。

处理状态：

- `likely_scanned === true` → 提示扫描件并使用图片重试。
- 422 `vision_not_supported` → 提示换模型或粘贴。
- 图片识别结束后 `deletePreparedFiles`。
- 文档挑选失败只提示，不覆盖已有文本。

- [ ] **Step 6: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-files.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add moyan-app/package.json moyan-app/package-lock.json moyan-app/app.json \
  moyan-app/src/lib/coach-files.ts moyan-app/src/app/coach/interview/index.tsx \
  moyan-app/src/app/coach/interview/materials.tsx moyan-app/src/lib/coach-files.test.ts
git commit -m "feat(moyan-app): add interview material import and OCR confirmation"
```

---

### Task 11: 敏感信息提示、档案生成与面试入口

**Files:**
- Create: `moyan-app/src/lib/sensitive-scan.ts`
- Create: `moyan-app/src/components/coach/SensitiveHints.tsx`
- Create: `moyan-app/src/app/coach/interview/profile.tsx`
- Modify: `moyan-app/src/app/coach/interview/materials.tsx`
- Test: `moyan-app/src/lib/sensitive-scan.test.ts`

**Interfaces:**
- Produces: `scanSensitive(text): SensitiveHit[]`
- Produces: `removeSensitiveHits(text, hits): string`
- Produces: `postInterviewProfile(kind, text)`

- [ ] **Step 1: 写失败测试**

```ts
it('finds phone, email and id hints without blocking text', () => {
  const hits = scanSensitive('电话 13800138000, mail a@b.com, id 110101199001011234');
  expect(hits.map((x) => x.kind)).toEqual(['phone', 'email', 'id']);
  expect(removeSensitiveHits('电话 13800138000', hits).includes('13800138000')).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/sensitive-scan.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 实现扫描与提示条**

正则只做提示，不自动执行。`SensitiveHints` 显示“发现 N 处疑似敏感信息”和“一键删除这 N 处”按钮；该按钮只调用用户点击时的删除逻辑。

- [ ] **Step 4: 实现档案预览**

材料确认页点击“生成面试档案”：

1. 对每个已确认材料分别调 `postInterviewProfile(kind, editedText)`。
2. 两份都有时合并成以 `[RESUME PROFILE]` / `[JOB PROFILE]` 分段的 `profile`，`kind` 设为 `resume_job`；只有一份时保留原 kind。
3. 成功跳 `/coach/interview/profile`，params 只带合并后的 `kind` 和 `profile`。
4. 档案页允许编辑；确认后保存一份 `InterviewProfileRecord`。
5. 点击“开始面试”跳 `/coach/session`，带 `scenarioId=interview_*` 与 `interviewKind/profile`。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/sensitive-scan.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/lib/sensitive-scan.ts moyan-app/src/components/coach/SensitiveHints.tsx \
  moyan-app/src/app/coach/interview/profile.tsx moyan-app/src/app/coach/interview/materials.tsx \
  moyan-app/src/lib/sensitive-scan.test.ts
git commit -m "feat(moyan-app): add interview profile preview and privacy hints"
```

---

### Task 12: 面试会话与复盘接入

**Files:**
- Modify: `moyan-app/src/app/coach/session.tsx`
- Modify: `moyan-app/src/app/coach/summary.tsx`
- Modify: `moyan-app/src/components/coach/FeedbackPanel.tsx`
- Test: `moyan-app/src/lib/coach-interview.test.ts`

**Interfaces:**
- Consumes: `InterviewContext { kind, profile }`
- Produces: `withInterviewContext(request, context)`，普通场景不新增字段

- [ ] **Step 1: 写失败测试**

```ts
it('sends compact profile and never raw text', () => {
  const request = withInterviewContext(baseTurn, { kind: 'resume', profile: '5 年后端...' });
  expect(request.interview?.profile).toBe('5 年后端...');
  expect(JSON.stringify(request)).not.toContain('原始简历全文');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-interview.test.ts --runInBand`
Expected: FAIL。

- [ ] **Step 3: 接入 turn/summary**

- 面试入口选择 `interview_screening` / `interview_behavioral` / `interview_technical` 三张预置卡。
- 进入面试会话时强制 `coach_mode: 'immersion'`，逐轮反馈面板隐藏，结束后统一复盘。
- session 请求每轮带 `interview: { kind, profile }`。
- summary 也带同一 `interview`。`kind` 可为 `resume` / `job` / `resume_job`；后端将其视为数据标签，不参与本地验签或权限判断。
- 总结页读到 `interview_feedback` 时替换普通“改进建议”分区标题为“面试官评估”。

- [ ] **Step 4: 视觉与文案**

面试复盘设计稿第 21 屏：展示 STAR 结构、量化成果、weak_spots；逐项带朗读按钮。所有文案走 i18n，字段缺失时隐藏分区，不显示 `undefined`。

- [ ] **Step 5: 验证**

Run: `cd moyan-app && npx jest src/lib/coach-interview.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app/coach/session.tsx moyan-app/src/app/coach/summary.tsx \
  moyan-app/src/components/coach/FeedbackPanel.tsx moyan-app/src/lib/coach-interview.test.ts
git commit -m "feat(moyan-app): connect interview context to coach session"
```

---

### Task 13: 陪练设置、i18n 与 8 套主题走查

**Files:**
- Create: `moyan-app/src/app/coach/settings.tsx`
- Modify: `moyan-app/src/lib/translations.ts`
- Modify: `moyan-app/src/app/(tabs)/settings.tsx`
- Modify: every coach screen/component from Tasks 3–12.
- Test: `moyan-app/src/lib/coach-i18n.test.ts`

**Interfaces:**
- Produces: `CoachPrefs { defaultMode, accentPreference, autoPlay }`
- Consumes: `loadCoachPrefs()`、`saveCoachPrefs()`

- [ ] **Step 1: 写失败测试**

```ts
it('has every coach key in both languages', () => {
  const keys = Object.keys(translations['zh-CN']).filter((k) => k.startsWith('coach'));
  for (const key of keys) expect(translations.en[key]).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd moyan-app && npx jest src/lib/coach-i18n.test.ts --runInBand`
Expected: FAIL，英文键缺失。

- [ ] **Step 3: 补齐 i18n**

所有键使用 `coach` 前缀，例如：

```ts
coachTab: '陪练',
coachQuota: '今日 {remaining}/{limit}',
coachQuotaExceeded: '今天的次数用完了，{time} 后恢复',
coachUnavailableLLM: 'AI 陪练暂不可用，请联系管理员配置模型',
coachListening: '在听你说…',
coachThinking: '正在思考…',
coachFeedback: '纠错',
coachBetterPhrasing: '更自然的说法',
coachInterviewResume: '简历',
coachInterviewJob: '职位',
coachGenerateProfile: '生成面试档案',
```

英文必须逐项对应。

- [ ] **Step 4: 实现设置页**

默认练习模式（逐轮/沉浸）、口音偏好、自动播放 AI 回复、面试档案管理、历史管理。口音偏好只决定预置排序，不修改后端数据。设置写入 AsyncStorage，并同步到现有 settings 页的入口。

- [ ] **Step 5: 主题走查**

对以下页面各跑 8 套主题：`(tabs)/coach`、`editor`、`session`、`summary`、`interview/materials`、`interview/profile`、`history`、`settings`。检查：

- session 用 `studyBg/studyCard/studyText/studyMuted`
- 其余页面用 `paper/card/ink/border`
- 按钮、禁用态、错误态对比度
- Reduce Motion 下头像静态、进度仍准确

Run:

```bash
cd moyan-app
npx jest --runInBand
npx tsc --noEmit
npx expo export --platform web
```

Expected: 全部通过，`dist/` 成功生成。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/src/app/coach/settings.tsx moyan-app/src/app/'(tabs)'/settings.tsx \
  moyan-app/src/lib/translations.ts moyan-app/src/lib/coach-i18n.test.ts moyan-app/src/app/coach moyan-app/src/components/coach
git commit -m "feat(moyan-app): polish coach i18n settings and themes"
```

---

### Task 14: 原生重建、真机验收与交付记录

**Files:**
- Modify: `moyan-app/app.json`
- Modify: `moyan-app/eas.json`（仅当构建 profile 缺失）
- Create: `docs/superpowers/verification/2026-09-27-moyan-ai-coach-app.md`

- [ ] **Step 1: 原生配置检查**

Run:

```bash
cd moyan-app
npx expo config --type public
npx expo-doctor
```

Expected: speech-recognition / image-picker / document-picker 插件出现在 config；doctor 无 error。

- [ ] **Step 2: 构建验证**

Run:

```bash
cd moyan-app
npx expo prebuild --clean
npx tsc --noEmit
npx expo export --platform web
```

Expected: prebuild 成功；TypeScript 与 web export 通过。

- [ ] **Step 3: iOS 真机清单**

必须逐项记录结果：

- 麦克风权限第一次允许/拒绝/再次开启
- 语音识别权限第一次允许/拒绝
- 静音开关下 TTS 可听
- 蓝牙耳机输入输出
- 打断 TTS 后立即开始 STT
- 切后台后返回，状态回到 idle，不丢历史
- 弱网 503 后重试，不重复扣配额

- [ ] **Step 4: Android 真机清单**

覆盖与 iOS 相同的权限、蓝牙、切后台和弱网项；额外验证：

- 返回键触发结束确认
- 分享/文件选择器返回 content:// URI 后能正确上传
- 相册 5 张压缩图片不会超过 4MB 合计
- 系统 TTS 中文音色读英文台词可听到中文口音

- [ ] **Step 5: 截图对比**

在 `xuanzhi` 与 `shenyemo`（或 `ios-dark`）各截：

- 场景选择
- 会话 listening
- 会话 speaking
- 总结
- 材料确认
- 档案预览

与 Home / Study / Settings 并排检查；结果写入 `docs/superpowers/verification/2026-09-27-moyan-ai-coach-app.md`。

- [ ] **Step 6: 提交**

```bash
git add moyan-app/app.json moyan-app/eas.json docs/superpowers/verification/2026-09-27-moyan-ai-coach-app.md
git commit -m "test(moyan-app): verify coach on ios and android"
```

---

## 自检记录

- **Spec 覆盖**：Tab 与词库迁移（T3）、场景选择（T4）、自定义/AI 草稿（T5）、头像（T6）、STT/TTS 状态机（T7–T8）、总结与历史（T9）、materials/profile/OCR（T10–T11）、面试上下文与复盘（T12）、i18n/主题（T13）、真机与截图（T14）均有任务。
- **Review Focus 对照**：配额失败（T4）、STT 降级（T7/T8）、重复提交与迟到响应（T7）、材料清理与 422（T10/T11）、主题与 Reduce Motion（T13）均有测试。
- **类型一致性**：所有端点、字段和错误 reason 与后端 `27276f1` 的 Rust/JSON 契约一致；`interview` 只传紧凑 `profile`。
- **未引入**：数字人、视频生成、服务端音频、第三方图标库、reanimated/lottie、断点续聊、自动脱敏。
