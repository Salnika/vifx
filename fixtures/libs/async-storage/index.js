import AsyncStorage from "@react-native-async-storage/async-storage";

export function setup() {
  return { getItem: AsyncStorage.getItem, setItem: AsyncStorage.setItem };
}

console.log("VIFX_LIB_CONSUMER_ASYNC_STORAGE", setup);
