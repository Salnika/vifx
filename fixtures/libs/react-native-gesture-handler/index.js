import { State, attachGestureHandler, gestureHandlerRootHOC } from "react-native-gesture-handler";

export function setup() {
  const attached = attachGestureHandler(42);
  return { attached, beganState: State.BEGAN, gestureHandlerRootHOC };
}

console.log("VIFX_LIB_CONSUMER_GESTURE_HANDLER", setup);
