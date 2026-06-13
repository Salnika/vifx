import { Image, prefetch } from "expo-image";

export function setup() {
  return { Image, prefetch };
}

console.log("VIFX_LIB_CONSUMER_EXPO_IMAGE", setup);
