import { expect, test } from "vite-plus/test";
import { expoExportScaffold } from "../src/index.ts";

test("expo-export scaffold stays explicit", () => {
  expect(expoExportScaffold.status).toBe("scaffold");
});
