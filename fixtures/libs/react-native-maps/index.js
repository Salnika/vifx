import MapView, { Marker } from "react-native-maps";

export function setup() {
  return { MapView, Marker };
}

console.log("VIFX_LIB_CONSUMER_MAPS", setup);
