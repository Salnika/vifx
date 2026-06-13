import { SafeAreaProvider, SafeAreaView, getSafeAreaInsets } from "react-native-safe-area-context";

export function setup() {
  const insets = getSafeAreaInsets();
  return { insets, SafeAreaProvider, SafeAreaView };
}

console.log("VIFX_LIB_CONSUMER_SAFE_AREA", setup);
