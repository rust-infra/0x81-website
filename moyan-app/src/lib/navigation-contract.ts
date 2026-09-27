export type TabIconName =
  | 'home'
  | 'coach'
  | 'podcast'
  | 'stats'
  | 'settings';

export const TAB_SCREENS = [
  { name: 'index', titleKey: 'tabHome', icon: 'home' },
  { name: 'coach', titleKey: 'tabCoach', icon: 'coach' },
  { name: 'podcast', titleKey: 'tabPodcast', icon: 'podcast' },
  { name: 'stats', titleKey: 'tabStats', icon: 'stats' },
  { name: 'settings', titleKey: 'tabSettings', icon: 'settings' },
] as const satisfies ReadonlyArray<{
  name: string;
  titleKey: string;
  icon: TabIconName;
}>;
