import createIconSet from "react-native-vector-icons";

const Icon = createIconSet({ home: 0xe88a }, "MaterialIcons");

export function setup() {
  return { Icon };
}

console.log("VIFX_LIB_CONSUMER_VECTOR_ICONS", setup);
