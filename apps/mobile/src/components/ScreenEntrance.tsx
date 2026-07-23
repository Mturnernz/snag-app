import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// A "soft mount" for a screen's first appearance — fade in while scaling up
// from 96% to 100%. Kept subtle on purpose: a bigger scale jump reads as
// bouncy rather than warm. Plays once, on mount, so it's meant for a screen's
// cold-open state rather than every focus/navigation.
export default function ScreenEntrance({ children, style }: Props) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
    scale.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[{ flex: 1 }, style, animatedStyle]}>{children}</Animated.View>;
}
