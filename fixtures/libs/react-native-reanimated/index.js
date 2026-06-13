import { useSharedValue, withTiming } from "react-native-reanimated";

export function animate() {
  const progress = useSharedValue(0);
  progress.value = withTiming(1);
  return progress;
}

console.log("VIFX_LIB_CONSUMER_REANIMATED", animate);
