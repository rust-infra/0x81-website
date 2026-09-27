import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { avatarMotion, type CoachAvatarState } from '../../lib/coach-avatar-model';
import type { CoachMood } from '../../lib/coach-types';
import { useTheme } from '../../lib/theme-context';

export function CoachAvatar({
  state,
  mood,
  size = 180,
  volume = 0,
  reduceMotion,
}: {
  state: CoachAvatarState;
  mood: CoachMood;
  size?: number;
  volume?: number;
  reduceMotion?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const breath = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const dots = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    let cancelled = false;
    if (reduceMotion === undefined) {
      AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
        if (!cancelled) setSystemReduceMotion(enabled);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [reduceMotion]);

  const motion = avatarMotion(
    state,
    reduceMotion ?? systemReduceMotion,
    mood
  );

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];
    if (motion.breathing) {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(breath, {
              toValue: 1.02,
              duration: 1500,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(breath, {
              toValue: 1,
              duration: 1500,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        )
      );
    }
    if (motion.pulse) {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1.06,
              duration: 700,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 1,
              duration: 700,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        )
      );
    }
    if (motion.dots) {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(dots, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(dots, { toValue: 0.25, duration: 500, useNativeDriver: true }),
          ])
        )
      );
    }
    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
      breath.setValue(1);
      pulse.setValue(1);
      dots.setValue(0.25);
    };
  }, [breath, dots, motion.breathing, motion.dots, motion.pulse, pulse]);

  const brow =
    motion.mood === 'concerned'
      ? 'M70 62 Q82 55 92 61 M108 61 Q120 55 132 62'
      : motion.mood === 'curious'
        ? 'M70 61 Q82 55 92 60 M108 58 Q120 54 132 60'
        : 'M70 60 Q82 56 92 60 M108 60 Q120 56 132 60';
  const mouth =
    motion.mood === 'encouraging'
      ? 'M82 111 Q101 125 120 111'
      : motion.mood === 'concerned'
        ? 'M84 117 Q101 108 118 117'
        : state === 'speaking'
          ? 'M84 112 Q101 124 118 112'
          : 'M86 113 Q101 120 116 113';

  return (
    <View
      testID={`coach-avatar-${state}`}
      style={[styles.wrap, { width: size, height: size }]}
    >
      {motion.pulse ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: c.accent,
              opacity: 0.2 + Math.min(0.45, volume * 0.45),
              transform: [{ scale: pulse }],
              width: size * 0.88,
              height: size * 0.88,
              borderRadius: size,
            },
          ]}
        />
      ) : null}
      <Animated.View
        style={{
          transform: [{ scale: breath }],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Ellipse cx="101" cy="112" rx="51" ry="56" fill={c.card} stroke={c.ink} strokeWidth="2" />
          <Path
            d="M62 108 Q50 82 62 57 Q77 33 101 32 Q128 32 141 57 Q152 83 140 108"
            fill="none"
            stroke={c.ink}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <Path d={brow} fill="none" stroke={c.ink} strokeWidth="2.4" strokeLinecap="round" />
          <Circle cx="83" cy="82" r="2.2" fill={c.ink} />
          <Circle cx="119" cy="82" r="2.2" fill={c.ink} />
          <Path d="M101 86 Q98 98 103 101" fill="none" stroke={c.inkLight} strokeWidth="1.8" strokeLinecap="round" />
          <Path d={mouth} fill="none" stroke={c.ink} strokeWidth="2.2" strokeLinecap="round" />
          <Path d="M47 179 Q52 140 79 133 M154 179 Q149 140 123 133" fill="none" stroke={c.ink} strokeWidth="3" strokeLinecap="round" />
          <Path d="M65 143 Q101 130 137 143" fill="none" stroke={c.inkLight} strokeWidth="1.5" />
        </Svg>
      </Animated.View>
      {motion.dots ? (
        <Animated.View style={[styles.dots, { opacity: dots }]}>
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: c.accent,
                  marginLeft: index === 0 ? 0 : 6,
                },
              ]}
            />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  dots: {
    position: 'absolute',
    bottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
