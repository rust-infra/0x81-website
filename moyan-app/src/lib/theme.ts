// 主题配置（数据与 moyan-web 一致；RN 无 DOM，只保留数据与类型）

export type ThemeName =
  | 'xuanzhi'
  | 'shenyemo'
  | 'zhuqing'
  | 'zhusha'
  | 'dailan'
  | 'fense'
  | 'ios';

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
    name: 'xuanzhi',
    label: '宣纸白',
    description: '温润米白，经典水墨',
    preview: '#F7F5F0',
    colors: {
      paper: '#F7F5F0',
      paperGradient: '#F7F5F0',
      card: '#FFFFFF',
      ink: '#2B2B2B',
      inkLight: '#5A5A5A',
      inkMuted: '#8A8A8A',
      accent: '#8C3B3B',
      accentLight: '#8C3B3B18',
      border: '#E8E4D9',
      navBg: '#FFFFFF',
      navText: '#5A5A5A',
      studyBg: '#F7F5F0',
      studyCard: '#FFFFFF',
      studyText: '#2B2B2B',
      studyMuted: 'rgba(43, 43, 43, 0.55)',
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
      paperGradient: '#1C1C1E',
      card: '#2C2C2E',
      ink: '#E8E4DC',
      inkLight: '#A09A92',
      inkMuted: '#6A6560',
      accent: '#C07060',
      accentLight: '#C0706020',
      border: '#3A3A3C',
      navBg: '#2C2C2E',
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
      paperGradient: '#EEF3EF',
      card: '#FFFFFF',
      ink: '#1E3328',
      inkLight: '#4A6B5A',
      inkMuted: '#7A9A8A',
      accent: '#2B6B4F',
      accentLight: '#2B6B4F18',
      border: '#D0DDD4',
      navBg: '#FFFFFF',
      navText: '#4A6B5A',
      studyBg: '#EEF3EF',
      studyCard: '#FFFFFF',
      studyText: '#1E3328',
      studyMuted: 'rgba(30, 51, 40, 0.55)',
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
      paperGradient: '#FDF5F0',
      card: '#FFFFFF',
      ink: '#3A1A18',
      inkLight: '#6B4846',
      inkMuted: '#9B7A78',
      accent: '#A84040',
      accentLight: '#A8404018',
      border: '#E8D4CC',
      navBg: '#FFFFFF',
      navText: '#6B4846',
      studyBg: '#FDF5F0',
      studyCard: '#FFFFFF',
      studyText: '#3A1A18',
      studyMuted: 'rgba(58, 26, 24, 0.55)',
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
      paperGradient: '#F0F2F5',
      card: '#FFFFFF',
      ink: '#1A2538',
      inkLight: '#4A5B74',
      inkMuted: '#7A8BA4',
      accent: '#3B5A7A',
      accentLight: '#3B5A7A18',
      border: '#D4D8E0',
      navBg: '#FFFFFF',
      navText: '#4A5B74',
      studyBg: '#F0F2F5',
      studyCard: '#FFFFFF',
      studyText: '#1A2538',
      studyMuted: 'rgba(26, 37, 56, 0.55)',
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
      paperGradient: '#FAF2F0',
      card: '#FFFFFF',
      ink: '#3A2228',
      inkLight: '#6B4A54',
      inkMuted: '#9B7A84',
      accent: '#8C4A5A',
      accentLight: '#8C4A5A18',
      border: '#E8D8D8',
      navBg: '#FFFFFF',
      navText: '#6B4A54',
      studyBg: '#FAF2F0',
      studyCard: '#FFFFFF',
      studyText: '#3A2228',
      studyMuted: 'rgba(58, 34, 40, 0.55)',
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
  {
    name: 'ios',
    label: 'iOS 清爽',
    description: '系统蓝，简洁明快',
    preview: '#F2F2F7',
    colors: {
      paper: '#F2F2F7',
      paperGradient: '#F2F2F7',
      card: '#FFFFFF',
      ink: '#000000',
      inkLight: '#3C3C43',
      inkMuted: '#8E8E93',
      accent: '#007AFF',
      accentLight: '#007AFF18',
      border: '#E5E5EA',
      navBg: '#F9F9F9',
      navText: '#3C3C43',
      studyBg: '#F2F2F7',
      studyCard: '#FFFFFF',
      studyText: '#000000',
      studyMuted: 'rgba(0, 0, 0, 0.55)',
      progressBar: '#007AFF',
      tagBg: 'rgba(0, 122, 255, 0.08)',
      tagText: '#3C3C43',
      buttonBg: '#007AFF',
      buttonText: '#FFFFFF',
      divider: '#E5E5EA',
      hoverBg: '#E9E9EB',
      inputBg: '#FFFFFF',
    },
  },
];
