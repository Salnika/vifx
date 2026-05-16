import { expect, test } from "vite-plus/test";
import { reactNativePluginScaffold } from "../src/index.ts";

test("react-native plugin scaffold stays explicit", () => {
  expect(reactNativePluginScaffold.status).toBe("scaffold");
});
