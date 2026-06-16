import { MMKV } from "react-native-mmkv";

export function setup() {
  const storage = new MMKV();
  return { storage };
}

console.log("VIFX_LIB_CONSUMER_MMKV", setup);
