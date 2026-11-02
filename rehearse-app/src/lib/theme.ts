// 主题配置。
//
// ⚠️ 2026-10-18：从墨言继承来的 4 套皮肤（宣纸白 / 深夜墨 / 黛蓝 / 藕粉）**已删除**，
// 只保留 light / dark 两套。依据是设计稿 `design/index.html` 顶部的约定：
//
//   职演有自己的配色，**不沿用墨言的水墨体系**。v1 只做 light / dark 两套，
//   不跟系统主题、不做多套皮肤。两套的色相完全对齐（强调色都是 210°），
//   只有明暗和饱和度的差别。
//
// 色值直接对齐设计稿的 `[data-theme="light"]` / `[data-theme="dark"]` 变量，
// 不再用墨言那套米白 + 墨红。理由写在设计稿里：职演面向「一次有 deadline 的
// 职场对话」，需要冷静、可信、专业；水墨是墨言的文人气质。
//
// 两条 token 语义规则（设计稿里踩过才写下来的）：
//   1. `buttonBg` / `tagBg` 是**中性**灰阶，两套主题下都不能沾强调色；
//   2. 强调色只给「正在进行 / 需要注意」的东西（麦克风、倒计时、进度、会话页），
//      结构性容器一律中性。

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  paper: string;
  paperGradient: string;
  card: string;
  ink: string;
  inkLight: string;
  inkMuted: string;
  accent: string;
  accentLight: string;
  border: string;
  navBg: string;
  navText: string;
  studyBg: string;
  studyCard: string;
  studyText: string;
  studyMuted: string;
  progressBar: string;
  tagBg: string;
  tagText: string;
  buttonBg: string;
  buttonText: string;
  divider: string;
  hoverBg: string;
  inputBg: string;
}

export interface Theme {
  name: ThemeName;
  label: string;
  description: string;
  preview: string;
  colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    name: 'light',
    label: '浅色',
    description: '冷静清晰，适合白天',
    preview: '#F4F5F7',
    colors: {
      paper: '#F4F5F7',
      paperGradient: '#F4F5F7',
      card: '#FFFFFF',
      ink: '#1A1D21',
      inkLight: '#4A5058',
      inkMuted: '#676E78',
      accent: '#2F5D8C',
      accentLight: '#2F5D8C14',
      border: '#E3E6EA',
      navBg: '#FFFFFF',
      navText: '#4A5058',
      // 会话面**跟随主题**（设计稿 2026-10-18「会话页浅色面」）：
      // 浅色主题下它就是一张浅色面，取值全部来自本主题已有的 token，
      // 不发明新色值。早先两套主题下 `study-*` 都是深色，主题开关在会话页
      // 近乎空转，而且「浅 → 黑 → 浅」把一次任务切成三段。
      studyBg: '#F4F5F7', // = paper
      studyCard: '#FFFFFF', // = card
      studyText: '#1A1D21', // = ink
      studyMuted: '#676E78', // = inkMuted
      progressBar: '#2F5D8C',
      tagBg: 'rgba(26,29,33,.06)',
      tagText: '#4A5058',
      buttonBg: '#1A1D21',
      buttonText: '#FFFFFF',
      divider: '#E3E6EA',
      hoverBg: '#EBEDF0',
      inputBg: '#F4F5F7',
    },
  },
  {
    name: 'dark',
    label: '深色',
    description: '夜间护眼，同一套设计',
    preview: '#14181C',
    colors: {
      paper: '#14181C',
      paperGradient: '#14181C',
      card: '#1D2228',
      ink: '#E9EDF1',
      inkLight: '#A8B1BA',
      inkMuted: '#8B949D',
      // 深色下 accent 是浅蓝，只能当文字/描边色；填充面另用更深的 buttonBg。
      accent: '#6FA3D9',
      accentLight: '#6FA3D920',
      border: '#2B3138',
      navBg: '#1D2228',
      navText: '#A8B1BA',
      studyBg: '#0D1114',
      studyCard: '#171C21',
      studyText: '#E9EDF1',
      studyMuted: 'rgba(233,237,241,.58)',
      progressBar: '#6FA3D9',
      tagBg: 'rgba(233,237,241,.08)',
      tagText: '#A8B1BA',
      buttonBg: '#E9EDF1',
      buttonText: '#14181C',
      divider: '#2B3138',
      hoverBg: '#232A31',
      inputBg: '#1D2228',
    },
  },
];

/**
 * 把旧版本存下来的主题名映射到新名字。
 *
 * 老版本有 4 套（`xuanzhi` / `shenyemo` / `dailan` / `fense`）。用户本地
 * `app_theme` 里可能还存着这些值；直接丢弃会让升级后主题「跳回默认」，
 * 所以按明暗归类迁移，而不是当成非法值。
 */
export function migrateThemeName(saved: string | null | undefined): ThemeName | null {
  switch (saved) {
    case 'light':
    case 'dark':
      return saved;
    case 'xuanzhi':
    case 'dailan':
    case 'fense':
      return 'light';
    case 'shenyemo':
      return 'dark';
    default:
      return null;
  }
}
