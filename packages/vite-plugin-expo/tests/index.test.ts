import { expect, test } from "vite-plus/test";
import { expoPluginScaffold } from "../src/index.ts";

test("expo plugin scaffold stays explicit", () => {
  expect(expoPluginScaffold.status).toBe("scaffold");
});
