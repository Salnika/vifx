import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import WebSocket from "ws";
import { executeCli } from "../src/index.ts";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../fixtures");

interface DevServerJson {
  bundleUrl: string;
  platform: string;
  projectRoot: string;
  sourceMapUrl: string | null;
  statusUrl: string;
  url: string;
}

interface RawSourceMapShape {
  mappings: string;
  sourceRoot?: string;
  sources: string[];
  version: number;
}

async function createRnBareProject(prefix: string, outDir: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const targetPath = path.join(tempRoot, "rn-bare-basic");

  await cp(path.join(FIXTURE_ROOT, "rn-bare-basic"), targetPath, { recursive: true });
  await writeFile(
    path.join(targetPath, "vifx.config.ts"),
    [
      "export default {",
      "  vite: {",
      '    mode: "react-native",',
      "    targets: [",
      "      {",
      '        platform: "ios",',
      '        entry: "./index.js",',
      `        outDir: ${JSON.stringify(outDir)},`,
      "        hermes: false,",
      "      },",
      "    ],",
      "  },",
      "};",
      "",
    ].join("\n"),
  );

  return targetPath;
}

function normalizeSourcePath(source: string) {
  return source
    .replaceAll("\\", "/")
    .replace(/\/\.\//gu, "/")
    .replace(/^\.\//u, "");
}

function findMappedGeneratedPosition(rawSourceMap: RawSourceMapShape) {
  const sourceMap = new SourceMap(rawSourceMap as ConstructorParameters<typeof SourceMap>[0]);

  for (let lineIndex = 0; lineIndex < 400; lineIndex += 1) {
    for (let columnIndex = 0; columnIndex < 80; columnIndex += 4) {
      const entry = sourceMap.findEntry(lineIndex, columnIndex);
      if ("originalSource" in entry && entry.originalSource) {
        return {
          column: columnIndex + 1,
          line: lineIndex + 1,
        };
      }
    }
  }

  return null;
}

test("dev --help prints Metro dev server usage", async () => {
  const result = await executeCli(["dev", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: vifx dev");
  expect(result.stdout).toContain("--platform");
  expect(result.stdout).toContain("--no-build");
  expect(result.stdout).toContain("/symbolicate");
  expect(result.stdout).toContain("8081");
});

test("root help lists the dev command", async () => {
  const result = await executeCli(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("dev [path]");
  expect(result.stdout).toContain("Metro-compatible dev server");
});

test("dev rejects Expo projects with a hint to use vifx expo dev", async () => {
  const result = await executeCli([
    "dev",
    path.join(FIXTURE_ROOT, "expo-basic"),
    "--platform",
    "ios",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_DEV_REQUIRES_REACT_NATIVE]");
  expect(result.stderr).toContain("vifx expo dev");
});

test("dev rejects unknown platforms", async () => {
  const result = await executeCli([
    "dev",
    path.join(FIXTURE_ROOT, "rn-bare-basic"),
    "--platform",
    "windows",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_DEV_INVALID_PLATFORM]");
});

test("dev --no-build fails with a bundle hint when artifacts are missing", async () => {
  const targetPath = await createRnBareProject("vifx-cli-dev-missing-", ".vifx/cli-dev/ios");

  const result = await executeCli([
    "dev",
    targetPath,
    "--platform",
    "ios",
    "--no-build",
    "--port",
    "0",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("[VIFX_DEV_BUNDLE_NOT_FOUND]");
  expect(result.stderr).toContain("vifx build");
});

test(
  "dev serves Metro endpoints against a temp-built rn-bare fixture",
  { timeout: 180_000 },
  async () => {
    const targetPath = await createRnBareProject("vifx-cli-dev-", ".vifx/cli-dev/ios");

    const result = await executeCli([
      "dev",
      targetPath,
      "--platform",
      "ios",
      "--json",
      "--port",
      "0",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.close).toBeDefined();

    try {
      const server = JSON.parse(result.stdout) as DevServerJson;

      expect(Object.keys(server).sort()).toEqual([
        "bundleUrl",
        "platform",
        "projectRoot",
        "sourceMapUrl",
        "statusUrl",
        "url",
      ]);
      expect(server.platform).toBe("ios");
      expect(server.projectRoot).toBe(targetPath);
      expect(server.bundleUrl).toContain("/index.bundle?platform=ios&dev=true");

      const statusResponse = await fetch(server.statusUrl);
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.text()).toBe("packager-status:running");

      const bundleResponse = await fetch(
        `${server.url}/index.bundle?platform=ios&dev=true&minify=false&hot=false&lazy=true&inlineSourceMap=false`,
      );
      expect(bundleResponse.status).toBe(200);
      expect(bundleResponse.headers.get("content-type")).toContain("application/javascript");
      const bundleSource = await bundleResponse.text();
      expect(bundleSource.length).toBeGreaterThan(0);
      expect(bundleSource).toContain("BareApp");

      expect(server.sourceMapUrl).not.toBeNull();
      const sourceMapResponse = await fetch(`${server.sourceMapUrl}?platform=ios&dev=true`);
      expect(sourceMapResponse.status).toBe(200);
      expect(sourceMapResponse.headers.get("content-type")).toContain("application/json");
      const rawSourceMap = JSON.parse(await sourceMapResponse.text()) as RawSourceMapShape;
      expect(rawSourceMap.version).toBe(3);
      expect(rawSourceMap.sources.length).toBeGreaterThan(0);
      expect(rawSourceMap.mappings.length).toBeGreaterThan(0);

      const shortMapResponse = await fetch(`${server.url}/index.map`);
      expect(shortMapResponse.status).toBe(200);

      const mappedPosition = findMappedGeneratedPosition(rawSourceMap);
      expect(mappedPosition).not.toBeNull();

      const symbolicateResponse = await fetch(`${server.url}/symbolicate`, {
        body: JSON.stringify({
          stack: [
            {
              column: mappedPosition!.column,
              file: server.bundleUrl,
              lineNumber: mappedPosition!.line,
              methodName: "anonymous",
            },
          ],
        }),
        method: "POST",
      });
      expect(symbolicateResponse.status).toBe(200);
      const symbolicated = (await symbolicateResponse.json()) as {
        stack: Array<{ column: number; file: string; lineNumber: number }>;
      };
      expect(symbolicated.stack).toHaveLength(1);
      const frame = symbolicated.stack[0]!;
      expect(typeof frame.lineNumber).toBe("number");
      expect(typeof frame.column).toBe("number");
      expect(rawSourceMap.sources.map((source) => normalizeSourcePath(source))).toContain(
        frame.file,
      );

      const unknownResponse = await fetch(`${server.url}/definitely-not-a-route`);
      expect(unknownResponse.status).toBe(404);

      const wrongBundleResponse = await fetch(`${server.url}/other-entry.bundle?platform=ios`);
      expect(wrongBundleResponse.status).toBe(404);

      const socket = new WebSocket(`${server.url.replace(/^http:/u, "ws:")}/message`);
      const identity = await new Promise<string | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("Timed out waiting for the getid response."));
        }, 10_000);

        socket.once("open", () => {
          socket.send(JSON.stringify({ id: 1, method: "getid", target: "server", version: 2 }));
        });
        socket.once("message", (data: Buffer | Buffer[] | string) => {
          clearTimeout(timeout);
          const payload =
            typeof data === "string"
              ? data
              : Array.isArray(data)
                ? Buffer.concat(data).toString("utf8")
                : data.toString("utf8");
          const parsed = JSON.parse(payload) as {
            id: number;
            result?: string;
            version: number;
          };
          resolve(parsed.version === 2 && parsed.id === 1 ? (parsed.result ?? null) : null);
          socket.close();
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      expect(identity).toMatch(/^vifx-/u);
    } finally {
      await result.close?.();
    }

    const reuseResult = await executeCli([
      "dev",
      targetPath,
      "--platform",
      "ios",
      "--json",
      "--port",
      "0",
      "--no-build",
    ]);

    expect(reuseResult.exitCode).toBe(0);

    try {
      const reusedServer = JSON.parse(reuseResult.stdout) as DevServerJson;
      const reusedStatus = await fetch(reusedServer.statusUrl);
      expect(reusedStatus.status).toBe(200);
      expect(await reusedStatus.text()).toBe("packager-status:running");
    } finally {
      await reuseResult.close?.();
    }
  },
);
