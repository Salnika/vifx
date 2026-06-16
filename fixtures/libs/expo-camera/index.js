import { CameraView, getAvailableCameraTypesAsync } from "expo-camera";

export function setup() {
  return { CameraView, getAvailableCameraTypesAsync };
}

console.log("VIFX_LIB_CONSUMER_EXPO_CAMERA", setup);
