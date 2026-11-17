import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { avatarMotion, type CoachAvatarState } from '../../lib/rehearse-avatar-model';
import type { CoachMood } from '../../lib/rehearse-types';
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
  const mouthOpen = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;

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
    if (motion.mouth) {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(mouthOpen, {
              toValue: 1,
              duration: 110,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(mouthOpen, {
              toValue: 0,
              duration: 150,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        )
      );
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(sway, {
              toValue: 1,
              duration: 900,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(sway, {
              toValue: -1,
              duration: 900,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        )
      );
    }
    if (motion.blink) {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.delay(2600),
            Animated.timing(blink, {
              toValue: 1,
              duration: 70,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(blink, {
              toValue: 0,
              duration: 90,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(1800),
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
      mouthOpen.setValue(0);
      blink.setValue(0);
      sway.setValue(0);
    };
  }, [
    blink,
    breath,
    dots,
    motion.blink,
    motion.breathing,
    motion.dots,
    motion.mouth,
    motion.pulse,
    mouthOpen,
    pulse,
    sway,
  ]);

  const brow =
    motion.mood === 'concerned'
      ? 'M70 62 Q82 55 92 61 M108 61 Q120 55 132 62'
      : motion.mood === 'curious'
        ? 'M70 61 Q82 55 92 60 M108 58 Q120 54 132 60'
        : 'M70 60 Q82 56 92 60 M108 60 Q120 56 132 60';
  const mouthPath =
    motion.mood === 'encouraging'
      ? 'M82 111 Q101 125 120 111'
      : motion.mood === 'concerned'
        ? 'M84 117 Q101 108 118 117'
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
          transform: [
            { scale: breath },
            {
              rotate: sway.interpolate({
                inputRange: [-1, 1],
                outputRange: ['-1.2deg', '1.2deg'],
              }),
            },
          ],
        }}
      >
        <View style={{ width: size, height: size }}>
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
            {motion.mouth ? null : (
              <Path d={mouthPath} fill="none" stroke={c.ink} strokeWidth="2.2" strokeLinecap="round" />
            )}
            <Path d="M47 179 Q52 140 79 133 M154 179 Q149 140 123 133" fill="none" stroke={c.ink} strokeWidth="3" strokeLinecap="round" />
            <Path d="M65 143 Q101 130 137 143" fill="none" stroke={c.inkLight} strokeWidth="1.5" />
          </Svg>
          {motion.mouth ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.speakingMouth,
                {
                  backgroundColor: c.card,
                  borderColor: c.ink,
                  borderWidth: Math.max(1.2, size * 0.012),
                  left: size * 0.43,
                  top: size * 0.565,
                  width: size * 0.15,
                  height: size * 0.045,
                  borderRadius: size,
                  transform: [
                    {
                      scaleY: mouthOpen.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 2.6],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}
          {motion.blink ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.eyelid,
                  {
                    backgroundColor: c.card,
                    borderBottomColor: c.ink,
                    borderBottomWidth: Math.max(1, size * 0.008),
                    width: size * 0.06,
                    height: size * 0.045,
                    left: size * 0.385,
                    top: size * 0.3875,
                    opacity: blink,
                    transform: [
                      {
                        scaleY: blink.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.2, 1],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.eyelid,
                  {
                    backgroundColor: c.card,
                    borderBottomColor: c.ink,
                    borderBottomWidth: Math.max(1, size * 0.008),
                    width: size * 0.06,
                    height: size * 0.045,
                    left: size * 0.565,
                    top: size * 0.3875,
                    opacity: blink,
                    transform: [
                      {
                        scaleY: blink.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.2, 1],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </>
          ) : null}
        </View>
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
  speakingMouth: {
    position: 'absolute',
  },
  eyelid: {
    position: 'absolute',
  },
});
