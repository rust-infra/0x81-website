import { Children, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

export type CoachGlyphName =
  | 'alert'
  | 'arrowRight'
  | 'camera'
  | 'chat'
  | 'check'
  | 'clock'
  | 'deadline'
  | 'design'
  | 'file'
  | 'history'
  | 'image'
  | 'keyboard'
  | 'manager'
  | 'mic'
  | 'micOff'
  | 'person'
  | 'plus'
  | 'review'
  | 'search'
  | 'standup'
  | 'spark'
  | 'stop'
  | 'text';

export function CoachGlyph({
  name,
  color,
  size = 19,
}: {
  name: CoachGlyphName;
  color: string;
  size?: number;
}) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  let content: ReactNode = null;
  switch (name) {
    case 'chat':
      content = (
        <>
          <Path {...common} d="M4 6.5h16v11H8.5L4 21z" />
          <Circle cx="9.5" cy="12" r=".8" fill={color} stroke="none" />
          <Circle cx="14.5" cy="12" r=".8" fill={color} stroke="none" />
          <Path {...common} d="M11 14.4c.6.5 1.4.5 2 0" />
        </>
      );
      break;
    case 'person':
      content = (
        <>
          <Circle {...common} cx="12" cy="8" r="3.2" />
          <Path {...common} d="M5.5 20c.6-4 3.3-6 6.5-6s5.9 2 6.5 6" />
        </>
      );
      break;
    case 'manager':
      content = (
        <>
          <Rect {...common} x="3.5" y="5" width="17" height="14" rx="3" />
          <Path {...common} d="M8 20v2M16 20v2" />
          <Circle cx="10" cy="11" r=".8" fill={color} stroke="none" />
          <Circle cx="14" cy="11" r=".8" fill={color} stroke="none" />
          <Path {...common} d="M10.4 13.8c.9.7 2.3.7 3.2 0" />
        </>
      );
      break;
    case 'search':
      content = (
        <>
          <Circle {...common} cx="11" cy="11" r="6" />
          <Path {...common} d="m15.5 15.5 4 4" />
        </>
      );
      break;
    case 'standup':
      content = (
        <>
          <Path {...common} d="M4 5.5h16v10H8.5L4 19z" />
          <Path {...common} d="M8 9.5h8M8 12h5" />
        </>
      );
      break;
    case 'review':
      content = (
        <>
          <Path {...common} d="M7 4.5h10v15H7z" />
          <Path {...common} d="M9.5 8h5M9.5 11h5M9.5 14h3" />
        </>
      );
      break;
    case 'design':
      content = (
        <>
          <Path {...common} d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
          <Circle {...common} cx="12" cy="12" r="2.6" />
        </>
      );
      break;
    case 'alert':
      content = (
        <>
          <Polygon {...common} points="12,3.5 21,20 3,20" />
          <Path {...common} d="M12 9v5M12 17.2v.1" />
        </>
      );
      break;
    case 'deadline':
      content = (
        <>
          <Path {...common} d="M12 4v16M5 8h14" />
          <Path {...common} d="M5 8 2.5 14h5zM19 8l-2.5 6h5z" />
        </>
      );
      break;
    case 'plus':
      content = <Path {...common} d="M12 6v12M6 12h12" />;
      break;
    case 'camera':
      content = (
        <>
          <Path {...common} d="M4 7.5h4l1.4-2h5.2l1.4 2h4v11H4z" />
          <Circle {...common} cx="12" cy="13" r="3.2" />
        </>
      );
      break;
    case 'image':
      content = (
        <>
          <Rect {...common} x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <Circle cx="9" cy="9.5" r="1.2" fill={color} stroke="none" />
          <Path {...common} d="m5.5 17 4.4-4.2 3.2 3 2.2-2 3.2 3.2" />
        </>
      );
      break;
    case 'file':
      content = (
        <>
          <Path {...common} d="M6.5 3.5h7l4 4v13h-11z" />
          <Path {...common} d="M13.5 3.5v4h4M9.5 12h5M9.5 15h5" />
        </>
      );
      break;
    case 'text':
      content = (
        <>
          <Path {...common} d="M4 6h16v12H4z" />
          <Path {...common} d="M7 9h10M7 12h8M7 15h5" />
        </>
      );
      break;
    case 'clock':
      content = (
        <>
          <Circle {...common} cx="12" cy="12" r="8" />
          <Path {...common} d="M12 7.5V12l3 2" />
        </>
      );
      break;
    case 'history':
      content = (
        <>
          <Circle {...common} cx="12" cy="12" r="7" />
          <Path {...common} d="M12 8v4l3 2M5.5 6.5 8 9" />
        </>
      );
      break;
    case 'mic':
      content = (
        <>
          <Rect {...common} x="9" y="3" width="6" height="11" rx="3" />
          <Path {...common} d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </>
      );
      break;
    case 'micOff':
      content = (
        <>
          <Path {...common} d="M9 5.5a3 3 0 0 1 6 0V11M9 8v3a3 3 0 0 0 4.6 2.5" />
          <Path {...common} d="M5.5 11a6.5 6.5 0 0 0 11 4.7M12 17.5V21M4 4l16 16" />
        </>
      );
      break;
    case 'keyboard':
      content = (
        <>
          <Rect {...common} x="3.5" y="6.5" width="17" height="11" rx="2.5" />
          <Path {...common} d="M7 10h.1M10 10h.1M13 10h.1M16 10h.1M7 13h.1M10 13h7M17 13h.1" />
        </>
      );
      break;
    case 'spark':
      content = (
        <>
          <Path {...common} d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <Path {...common} d="m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </>
      );
      break;
    case 'stop':
      content = <Rect {...common} x="8" y="8" width="8" height="8" rx="1.5" />;
      break;
    case 'check':
      content = <Path {...common} d="m5.5 12.5 4 4 9-10" />;
      break;
    case 'arrowRight':
      content = <Path {...common} d="m9 5 7 7-7 7" />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {content}
    </Svg>
  );
}

export function CoachHeader({
  title,
  onBack,
  right,
  serifTitle = true,
  style,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  serifTitle?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.header, style]}>
      {onBack ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onBack} style={styles.back}>
          <Text style={[styles.backText, { color: c.ink }]}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.headerTitle,
          { color: c.ink, fontFamily: serifTitle ? serif : undefined },
        ]}
      >
        {title}
      </Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionText, { color: c.inkLight }]}>{children}</Text>
      <View style={[styles.sectionLine, { backgroundColor: c.divider }]} />
      {action}
    </View>
  );
}

export function CoachGroup({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const items = Children.toArray(children);
  return (
    <View style={[styles.group, { backgroundColor: c.card, borderColor: c.border }]}>
      {items.map((child, index) => (
        <View
          key={index}
          style={[
            index > 0
              ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.divider }
              : null,
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function CoachRow({
  icon,
  title,
  subtitle,
  meta,
  badge,
  right,
  onPress,
  onLongPress,
  selected,
  dashed,
  plain,
}: {
  icon?: CoachGlyphName | ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  dashed?: boolean;
  plain?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const iconNode =
    typeof icon === 'string'
      ? <CoachGlyph name={icon as CoachGlyphName} color={selected ? c.accent : c.ink} size={19} />
      : icon;
  const body = (
    <>
      {iconNode ? (
        <View
          style={[
            styles.rowIcon,
            plain && styles.rowIconPlain,
            {
              backgroundColor: dashed || selected ? c.accentLight : c.tagBg,
            },
          ]}
        >
          {iconNode}
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: c.ink }]}>
            {title}
          </Text>
          {badge ? (
            <Text style={[styles.badge, { color: c.accent, backgroundColor: c.accentLight }]}>
              {badge}
            </Text>
          ) : null}
          {meta ? (
            <Text numberOfLines={1} style={[styles.rowMeta, { color: c.inkMuted }]}>
              {meta}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: c.inkMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );

  const rowStyle = [
    styles.row,
    dashed && styles.dashed,
    selected && { backgroundColor: c.accentLight },
    dashed && { backgroundColor: c.card, borderColor: c.accent },
  ];
  if (onPress || onLongPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onLongPress={onLongPress}
        style={rowStyle}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{body}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = 'default',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'accent' | 'default';
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.primary,
        {
          backgroundColor:
            disabled ? c.inkMuted : variant === 'accent' ? c.accent : c.buttonBg,
        },
      ]}
    >
      <Text style={[styles.primaryText, { color: c.buttonText }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, { borderColor: c.border }]}
    >
      <Text style={{ color: disabled ? c.inkMuted : c.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, lineHeight: 28, marginTop: -2 },
  headerTitle: { flex: 1, fontSize: 19, fontWeight: '700', letterSpacing: 0.1 },
  headerRight: { minWidth: 34, alignItems: 'flex-end' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 },
  sectionText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth },
  group: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: {
    minHeight: 55,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  dashed: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 14, marginTop: 0 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowIconPlain: { width: 20, backgroundColor: 'transparent' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowTitle: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowMeta: { marginLeft: 'auto', fontSize: 10.5, flexShrink: 0 },
  rowSubtitle: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  badge: {
    fontSize: 9.5,
    fontWeight: '600',
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  primary: { width: '100%', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 14, fontWeight: '700' },
  secondary: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
  },
});
