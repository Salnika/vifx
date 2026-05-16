import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { buildPlatformCandidates, resolveReactNativeModule } from "../src/index.ts";

describe("@vifx/platform-resolver", () => {
  it("builds Metro-like platform candidate order", () => {
    expect(buildPlatformCandidates("/tmp/Button", "ios", ["tsx", "ts"])).toEqual([
      "/tmp/Button.ios.tsx",
      "/tmp/Button.native.tsx",
      "/tmp/Button.tsx",
      "/tmp/Button.ios.ts",
      "/tmp/Button.native.ts",
      "/tmp/Button.ts",
    ]);
  });

  it("resolves relative imports with platform overrides", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-resolver-"));
    const srcDir = path.join(projectRoot, "src");
    await mkdir(srcDir);
    await writeFile(path.join(srcDir, "App.tsx"), "export const App = null;\n", "utf8");
    await writeFile(
      path.join(srcDir, "Button.native.tsx"),
      "export const Button = 'native';\n",
      "utf8",
    );
    await writeFile(path.join(srcDir, "Button.ios.tsx"), "export const Button = 'ios';\n", "utf8");

    const result = await resolveReactNativeModule({
      fromFile: path.join(srcDir, "App.tsx"),
      platform: "ios",
      projectRoot,
      specifier: "./Button",
    });

    expect(result.filePath.endsWith("Button.ios.tsx")).toBe(true);
    expect(result.trace.some((step) => step.found)).toBe(true);
  });

  it("resolves workspace package entries via the react-native field", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-workspace-"));
    const appDir = path.join(projectRoot, "apps", "mobile", "src");
    const packageDir = path.join(projectRoot, "packages", "ui", "src");
    await mkdir(appDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(appDir, "App.tsx"), "export const App = null;\n", "utf8");
    await writeFile(
      path.join(projectRoot, "packages", "ui", "package.json"),
      JSON.stringify(
        {
          name: "@demo/ui",
          "react-native": "./src/Button",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(packageDir, "Button.native.tsx"),
      "export const Button = 'native';\n",
      "utf8",
    );
    await writeFile(
      path.join(packageDir, "Button.android.tsx"),
      "export const Button = 'android';\n",
      "utf8",
    );

    const result = await resolveReactNativeModule({
      fromFile: path.join(appDir, "App.tsx"),
      platform: "android",
      projectRoot,
      specifier: "@demo/ui",
    });

    expect(result.packageName).toBe("@demo/ui");
    expect(result.filePath.endsWith("Button.android.tsx")).toBe(true);
  });
});
