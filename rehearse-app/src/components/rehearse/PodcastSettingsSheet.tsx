import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

const SPEEDS = [0.5, 0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;

function nearestSpeedIndex(rate: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  SPEEDS.forEach((value, index) => {
    const next = Math.abs(value - rate);
    if (next < distance) {
      best = index;
      distance = next;
    }
  });
  return best;
}

function formatSpeed(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}×`;
}

export function PodcastSettingsSheet({
  visible,
  onClose,
  rate,
  onRate,
  autoplay,
  onAutoplay,
  pauseEachLine,
  onPauseEachLine,
  loopLine,
  onLoopLine,
  translation,
  onTranslation,
  generating,
  onGenerate,
}: {
  visible: boolean;
  onClose: () => void;
  rate: number;
  onRate: (rate: number) => void;
  autoplay: boolean;
  onAutoplay: (value: boolean) => void;
  pauseEachLine: boolean;
  onPauseEachLine: (value: boolean) => void;
  loopLine: boolean;
  onLoopLine: (value: boolean) => void;
  translation: boolean;
  onTranslation: (value: boolean) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const { height } = useWindowDimensions();
  const anim = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) panY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.8) {
            Animated.timing(panY, {
              toValue: 360,
              duration: 160,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              panY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 20,
          }).start();
        },
      }),
    [onClose, panY]
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      anim.setValue(0);
      panY.setValue(0);
      requestAnimationFrame(() => {
        Animated.timing(anim, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [anim, visible]);

  if (!mounted) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [360, 0],
  });
  const speedIndex = nearestSpeedIndex(rate);
  const speed = SPEEDS[speedIndex];
  const maxHeight = height * (2 / 3);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.mask, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              maxHeight,
              transform: [
                { translateY: Animated.add(translateY, panY) },
              ],
            },
          ]}
        >
          <View
            {...panResponder.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel={t('podcastSwipeToClose')}
            style={styles.dragZone}
          >
            <View style={[styles.handle, { backgroundColor: c.divider }]} />
          </View>
          <Text style={[styles.title, { color: c.ink, fontFamily: serif }]}>
            {t('podcastSettings')}
          </Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sectionLabel, { color: c.inkMuted }]}>
              {t('podcastPlaybackSection')}
            </Text>
            <View style={[styles.group, { backgroundColor: c.inputBg }]}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.inkMuted }]}>
                  {t('podcastSpeed')}
                </Text>
                <View style={styles.speedControl}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('podcastSlower')}
                    disabled={speedIndex === 0}
                    onPress={() => onRate(SPEEDS[speedIndex - 1])}
                    style={[
                      styles.speedButton,
                      {
                        backgroundColor: c.card,
                        borderColor: c.border,
                        opacity: speedIndex === 0 ? 0.35 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.speedButtonText, { color: c.ink }]}>−</Text>
                  </Pressable>
                  <Text style={[styles.speedValue, { color: c.ink }]}>
                    {formatSpeed(speed)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('podcastFaster')}
                    disabled={speedIndex === SPEEDS.length - 1}
                    onPress={() => onRate(SPEEDS[speedIndex + 1])}
                    style={[
                      styles.speedButton,
                      {
                        backgroundColor: c.card,
                        borderColor: c.border,
                        opacity: speedIndex === SPEEDS.length - 1 ? 0.35 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.speedButtonText, { color: c.ink }]}>＋</Text>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View
                style={[
                  styles.row,
                  pauseEachLine || loopLine ? styles.rowDisabled : null,
                ]}
              >
                <Text style={[styles.label, { color: c.inkMuted }]}>
                  {t('podcastAutoplay')}
                </Text>
                <Switch
                  disabled={pauseEachLine || loopLine}
                  value={autoplay}
                  onValueChange={onAutoplay}
                  trackColor={{ false: c.border, true: c.accentLight }}
                  thumbColor={autoplay ? c.accent : c.inkMuted}
                />
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.inkMuted }]}>
                  {t('podcastPauseEachLine')}
                </Text>
                <Switch
                  accessibilityLabel={`${t('podcastPauseEachLine')} switch`}
                  value={pauseEachLine}
                  onValueChange={onPauseEachLine}
                  trackColor={{ false: c.border, true: c.accentLight }}
                  thumbColor={pauseEachLine ? c.accent : c.inkMuted}
                />
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.inkMuted }]}>
                  {t('podcastLoopLine')}
                </Text>
                <Switch
                  accessibilityLabel={`${t('podcastLoopLine')} switch`}
                  value={loopLine}
                  onValueChange={onLoopLine}
                  trackColor={{ false: c.border, true: c.accentLight }}
                  thumbColor={loopLine ? c.accent : c.inkMuted}
                />
              </View>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: c.inkMuted }]}>
                  {t('podcastTranslation')}
                </Text>
                <Switch
                  value={translation}
                  onValueChange={onTranslation}
                  trackColor={{ false: c.border, true: c.accentLight }}
                  thumbColor={translation ? c.accent : c.inkMuted}
                />
              </View>
            </View>
            {loopLine ? (
              <Text style={[styles.hint, styles.shadowingHint, { color: c.inkMuted }]}>
                {t('podcastLoopLineHint')}
              </Text>
            ) : pauseEachLine ? (
              <Text style={[styles.hint, styles.shadowingHint, { color: c.inkMuted }]}>
                {t('podcastShadowingHint')}
              </Text>
            ) : null}
            <Text style={[styles.sectionLabel, { color: c.inkMuted }]}>
              {t('podcastDigitalHumanSection')}
            </Text>
            <View style={[styles.group, { backgroundColor: c.inputBg }]}>
              <Pressable
                accessibilityRole="button"
                disabled={generating}
                onPress={onGenerate}
                style={styles.generateRow}
              >
                <Text style={{ color: c.ink, fontWeight: '700' }}>
                  {generating ? t('podcastGenerating') : t('podcastGenerateEpisode')}
                </Text>
              </Pressable>
              <Text style={[styles.hint, { color: c.inkMuted }]}>
                {t('podcastForegroundHint')}
              </Text>
            </View>
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.done, { backgroundColor: c.buttonBg }]}
          >
            <Text style={{ color: c.buttonText, fontWeight: '700' }}>
              {t('podcastDone')}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  mask: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 22,
    gap: 8,
  },
  scroll: { flexShrink: 1 },
  content: { gap: 8, paddingTop: 2, paddingBottom: 2 },
  dragZone: {
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
    marginBottom: 2,
    userSelect: 'none',
  },
  handle: { width: 44, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 2 },
  title: { fontSize: 17, fontWeight: '700' },
  sectionLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.4, marginTop: 2 },
  group: { borderRadius: 14, paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
  },
  rowDisabled: { opacity: 0.45 },
  divider: { height: StyleSheet.hairlineWidth },
  label: { fontSize: 13 },
  speedControl: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  speedButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedButtonText: { fontSize: 17, fontWeight: '600', lineHeight: 20 },
  speedValue: {
    minWidth: 50,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  generateRow: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  hint: { fontSize: 11, textAlign: 'center', paddingBottom: 10 },
  shadowingHint: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'left',
    paddingHorizontal: 4,
    paddingBottom: 0,
  },
  done: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
});
