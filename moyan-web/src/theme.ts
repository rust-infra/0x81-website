// 主题配置系统 - 支持多种水墨风格主题切换

export type ThemeName = 'xuanzhi' | 'shenyemo' | 'zhuqing' | 'zhusha' | 'dailan' | 'fense';

export interface Theme {
  name: ThemeName;
  label: string;
  description: string;
  preview: string; // 预览色
  colors: {
    paper: string;           // 背景色
    paperGradient: string;   // 顶部渐变
    card: string;            // 卡片背景
    ink: string;             // 主文字/浓墨
    inkLight: string;        // 次要文字/淡墨
    inkMuted: string;        // 辅助文字
    accent: string;          // 强调色/朱砂
    accentLight: string;     // 强调色淡版
    border: string;          // 边框色
    navBg: string;           // 导航背景
    navText: string;         // 导航文字
    studyBg: string;         // 学习页背景
    studyCard: string;       // 学习页卡片
    studyText: string;       // 学习页文字
    studyMuted: string;      // 学习页次要文字
    progressBar: string;     // 进度条色
    tagBg: string;           // 标签背景
    tagText: string;         // 标签文字
    buttonBg: string;        // 按钮背景
    buttonText: string;      // 按钮文字
    divider: string;         // 分割线
    hoverBg: string;         // hover背景
    inputBg: string;         // 输入框背景
  };
}

export const THEMES: Theme[] = [
  {
    name: 'xuanzhi',
    label: '宣纸白',
    description: '温润米白，经典水墨',
    preview: '#F7F5F0',
    colors: {
      paper: '#F7F5F0',
      paperGradient: 'linear-gradient(to bottom, #F7F5F0, #EDEAE3)',
      card: '#FFFFFF',
      ink: '#2B2B2B',
      inkLight: '#5A5A5A',
      inkMuted: '#8A8A8A',
      accent: '#8C3B3B',
      accentLight: '#8C3B3B18',
      border: '#E8E4D9',
      navBg: 'rgba(255, 255, 255, 0.85)',
      navText: '#5A5A5A',
      studyBg: '#1A1A1A',
      studyCard: '#252525',
      studyText: '#FFFFFF',
      studyMuted: 'rgba(255, 255, 255, 0.4)',
      progressBar: '#8C3B3B',
      tagBg: 'rgba(43, 43, 43, 0.08)',
      tagText: '#5A5A5A',
      buttonBg: '#2B2B2B',
      buttonText: '#FFFFFF',
      divider: '#E8E4D9',
      hoverBg: '#F0EDE6',
      inputBg: '#F7F5F0',
    },
  },
  {
    name: 'shenyemo',
    label: '深夜墨',
    description: '浓墨深邃，护目不扰',
    preview: '#1C1C1E',
    colors: {
      paper: '#1C1C1E',
      paperGradient: 'linear-gradient(to bottom, #1C1C1E, #141415)',
      card: '#2C2C2E',
      ink: '#E8E4DC',
      inkLight: '#A09A92',
      inkMuted: '#6A6560',
      accent: '#C07060',
      accentLight: '#C0706020',
      border: '#3A3A3C',
      navBg: 'rgba(44, 44, 46, 0.85)',
      navText: '#A09A92',
      studyBg: '#121214',
      studyCard: '#1C1C1E',
      studyText: '#E8E4DC',
      studyMuted: 'rgba(232, 228, 220, 0.35)',
      progressBar: '#C07060',
      tagBg: 'rgba(232, 228, 220, 0.08)',
      tagText: '#A09A92',
      buttonBg: '#E8E4DC',
      buttonText: '#1C1C1E',
      divider: '#3A3A3C',
      hoverBg: '#363638',
      inputBg: '#2C2C2E',
    },
  },
  {
    name: 'zhuqing',
    label: '竹青',
    description: '清雅翠绿，生机盎然',
    preview: '#EEF3EF',
    colors: {
      paper: '#EEF3EF',
      paperGradient: 'linear-gradient(to bottom, #EEF3EF, #E2EBE4)',
      card: '#FFFFFF',
      ink: '#1E3328',
      inkLight: '#4A6B5A',
      inkMuted: '#7A9A8A',
      accent: '#2B6B4F',
      accentLight: '#2B6B4F18',
      border: '#D0DDD4',
      navBg: 'rgba(255, 255, 255, 0.85)',
      navText: '#4A6B5A',
      studyBg: '#142820',
      studyCard: '#1E3328',
      studyText: '#E8F0EC',
      studyMuted: 'rgba(232, 240, 236, 0.35)',
      progressBar: '#2B6B4F',
      tagBg: 'rgba(43, 107, 79, 0.08)',
      tagText: '#4A6B5A',
      buttonBg: '#1E3328',
      buttonText: '#FFFFFF',
      divider: '#D0DDD4',
      hoverBg: '#E2EBE4',
      inputBg: '#EEF3EF',
    },
  },
  {
    name: 'zhusha',
    label: '朱砂',
    description: '暖红沉韵，喜庆雅致',
    preview: '#FDF5F0',
    colors: {
      paper: '#FDF5F0',
      paperGradient: 'linear-gradient(to bottom, #FDF5F0, #F5E8E0)',
      card: '#FFFFFF',
      ink: '#3A1A18',
      inkLight: '#6B4846',
      inkMuted: '#9B7A78',
      accent: '#A84040',
      accentLight: '#A8404018',
      border: '#E8D4CC',
      navBg: 'rgba(255, 255, 255, 0.85)',
      navText: '#6B4846',
      studyBg: '#2A1616',
      studyCard: '#3A1A18',
      studyText: '#F5E8E0',
      studyMuted: 'rgba(245, 232, 224, 0.35)',
      progressBar: '#A84040',
      tagBg: 'rgba(168, 64, 64, 0.08)',
      tagText: '#6B4846',
      buttonBg: '#3A1A18',
      buttonText: '#FFFFFF',
      divider: '#E8D4CC',
      hoverBg: '#F5E8E0',
      inputBg: '#FDF5F0',
    },
  },
  {
    name: 'dailan',
    label: '黛蓝',
    description: '墨蓝沉稳，科技雅致',
    preview: '#F0F2F5',
    colors: {
      paper: '#F0F2F5',
      paperGradient: 'linear-gradient(to bottom, #F0F2F5, #E4E7ED)',
      card: '#FFFFFF',
      ink: '#1A2538',
      inkLight: '#4A5B74',
      inkMuted: '#7A8BA4',
      accent: '#3B5A7A',
      accentLight: '#3B5A7A18',
      border: '#D4D8E0',
      navBg: 'rgba(255, 255, 255, 0.85)',
      navText: '#4A5B74',
      studyBg: '#121A28',
      studyCard: '#1A2538',
      studyText: '#E0E4EA',
      studyMuted: 'rgba(224, 228, 234, 0.35)',
      progressBar: '#3B5A7A',
      tagBg: 'rgba(59, 90, 122, 0.08)',
      tagText: '#4A5B74',
      buttonBg: '#1A2538',
      buttonText: '#FFFFFF',
      divider: '#D4D8E0',
      hoverBg: '#E4E7ED',
      inputBg: '#F0F2F5',
    },
  },
  {
    name: 'fense',
    label: '藕粉',
    description: '柔粉温润，清新脱俗',
    preview: '#FAF2F0',
    colors: {
      paper: '#FAF2F0',
      paperGradient: 'linear-gradient(to bottom, #FAF2F0, #F0E4E0)',
      card: '#FFFFFF',
      ink: '#3A2228',
      inkLight: '#6B4A54',
      inkMuted: '#9B7A84',
      accent: '#8C4A5A',
      accentLight: '#8C4A5A18',
      border: '#E8D8D8',
      navBg: 'rgba(255, 255, 255, 0.85)',
      navText: '#6B4A54',
      studyBg: '#2A1A20',
      studyCard: '#3A2228',
      studyText: '#F0E4E0',
      studyMuted: 'rgba(240, 228, 224, 0.35)',
      progressBar: '#8C4A5A',
      tagBg: 'rgba(140, 74, 90, 0.08)',
      tagText: '#6B4A54',
      buttonBg: '#3A2228',
      buttonText: '#FFFFFF',
      divider: '#E8D8D8',
      hoverBg: '#F0E4E0',
      inputBg: '#FAF2F0',
    },
  },
];

const THEME_KEY = 'app_theme';

export function getCurrentTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY) as ThemeName | null;
  return THEMES.find(t => t.name === saved) || THEMES[0];
}

export function setTheme(name: ThemeName): void {
  localStorage.setItem(THEME_KEY, name);
  applyTheme(name);
}

export function applyTheme(name: ThemeName): void {
  const theme = THEMES.find(t => t.name === name);
  if (!theme) return;

  const root = document.documentElement;
  const c = theme.colors;

  // 设置 CSS 自定义属性
  root.style.setProperty('--paper', c.paper);
  root.style.setProperty('--paper-grad-start', c.paperGradient);
  root.style.setProperty('--card', c.card);
  root.style.setProperty('--ink', c.ink);
  root.style.setProperty('--ink-light', c.inkLight);
  root.style.setProperty('--ink-muted', c.inkMuted);
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-light', c.accentLight);
  root.style.setProperty('--border', c.border);
  root.style.setProperty('--nav-bg', c.navBg);
  root.style.setProperty('--nav-text', c.navText);
  root.style.setProperty('--study-bg', c.studyBg);
  root.style.setProperty('--study-card', c.studyCard);
  root.style.setProperty('--study-text', c.studyText);
  root.style.setProperty('--study-muted', c.studyMuted);
  root.style.setProperty('--progress', c.progressBar);
  root.style.setProperty('--tag-bg', c.tagBg);
  root.style.setProperty('--tag-text', c.tagText);
  root.style.setProperty('--btn-bg', c.buttonBg);
  root.style.setProperty('--btn-text', c.buttonText);
  root.style.setProperty('--divider', c.divider);
  root.style.setProperty('--hover', c.hoverBg);
  root.style.setProperty('--input-bg', c.inputBg);

  // 设置 data-theme 属性供 Tailwind 使用
  root.setAttribute('data-theme', name);
}

export function getThemeName(): ThemeName {
  return (localStorage.getItem(THEME_KEY) as ThemeName) || 'xuanzhi';
}
