import { Screen, ScreenContainer, enableScreens } from "react-native-screens";

export function setup() {
  enableScreens(true);
  return { Screen, ScreenContainer };
}

console.log("VIFX_LIB_CONSUMER_SCREENS", setup);
