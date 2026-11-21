import { Image, View } from 'react-native';

const LEARNER_RABBIT = require('../../../assets/podcast/learner-rabbit.png');

/**
 * 学习搭子 / “You” 侧形象。
 *
 * 兔子用来和狐狸教练形成清楚的角色对位（也呼应 Nick + Judy 的经典搭档感）；
 * 先作为临时头像，后续可以和狐狸一起重绘成同一套线稿。
 */
export function PodcastLearnerAvatar({ size = 30 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#9db3c8',
        backgroundColor: '#f3eee4',
        padding: 1,
      }}
    >
      <Image
        source={LEARNER_RABBIT}
        resizeMode="contain"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}
