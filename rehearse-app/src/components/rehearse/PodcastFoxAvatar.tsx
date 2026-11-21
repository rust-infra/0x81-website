import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';

const FOX_STAGE = require('../../../assets/podcast/fox-stage.png');
const FOX_HEAD = require('../../../assets/podcast/fox-head.png');

/**
 * 临时播客主播：直接用当前定稿的狐狸图。
 *
 * - head：聊天气泡 / 折叠主播条 / 列表小头像
 * - stage：演播室半身，带一点呼吸，不假装口型
 *
 * 这是“先用这个”的落地版本；后续换成 Rive/Spine 分层角色时，
 * 只需要替换这个组件，播放器不用改。
 */
export function PodcastFoxAvatar({
  variant = 'head',
  size = 56,
  width,
  height,
}: {
  variant?: 'head' | 'stage';
  size?: number;
  width?: number;
  height?: number;
}) {
  const breath = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (variant !== 'stage') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.012,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breath, variant]);

  if (variant === 'stage') {
    const stageWidth = width ?? size;
    const stageHeight = height ?? Math.round((size * 4) / 3);
    return (
      <Animated.View
        style={{
          width: stageWidth,
          height: stageHeight,
          overflow: 'hidden',
          borderRadius: 18,
          transform: [{ scale: breath }],
        }}
      >
        <Image
          source={FOX_STAGE}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
      }}
    >
      <Image
        source={FOX_HEAD}
        resizeMode="cover"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}
