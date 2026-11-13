// Dev engine contract of the Expo Go dev server: what a running app sees on
// `/hot` when a file is saved, and what the server guarantees around it
// (assets, symbolication, a project that does not compile). Each case is one
// a real Expo Go session exposed; see apps/docs/guide/status.md, "Expo Go validation".

import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { VifxRebuildReport } from "@vifx/types";
import { expect, test } from "vite-plus/test";
import { WebSocket } from "ws";
import { startExpoGoDevServer } from "../src/index.ts";
import {
  canListenOnLocalhost,
  createExpoGoTestProject,
  type ExpoGoTestProject,
  startTestServer,
  type TestServerHandle,
  type TestServerOverrides,
} from "./harness.ts";

const ENGINE_TEST = (await canListenOnLocalhost()) ? test : test.skip;

const ENTRY_SOURCE = (label: string) =>
  [
    'import { registerRootComponent } from "expo";',
    'import runtimeIcon from "./assets/icon.png";',
    "function HarnessRoot() {",
    "  return runtimeIcon;",
    "}",
    `console.log(${JSON.stringify(label)}, runtimeIcon);`,
    "registerRootComponent(HarnessRoot);",
    "",
  ].join("\n");

/** 1-based line of the `console.log` statement in {@link ENTRY_SOURCE}. */
const ENTRY_LOG_LINE = 6;

async function withServer(
  overrides: TestServerOverrides,
  body: (handle: TestServerHandle, project: ExpoGoTestProject) => Promise<void>,
): Promise<void> {
  const project = await createExpoGoTestProject();
  const handle = await startTestServer(project, overrides);
  try {
    await body(handle, project);
  } finally {
    await handle.cleanup();
    await rm(project.projectRoot, { force: true, recursive: true });
  }
}

async function waitUntil<T>(
  read: () => T | undefined | Promise<T | undefined>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

interface HotMessage {
  body?: Record<string, unknown>;
  type: string;
}

/**
 * The app's side of `/hot`: every message is kept, so nothing sent between two
 * awaits is lost (a save produces several in a row).
 */
async function connectApp(handle: TestServerHandle) {
  const socket = new WebSocket(`${handle.server.url.replace(/^http:/u, "ws:")}/hot`);
  const messages: HotMessage[] = [];
  socket.on("message", (data: Buffer) => {
    messages.push(JSON.parse(data.toString("utf8")) as HotMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  return {
    close: () => socket.close(),
    messages,
    next: (type: string, after = 0) =>
      waitUntil(
        () => messages.slice(after).find((message) => message.type === type),
        `a "${type}" message on /hot`,
      ),
    send: (message: unknown) => socket.send(JSON.stringify(message)),
  };
}

/** What the served bundle says about itself, as the app's HMR client reads it. */
async function readBundleState(handle: TestServerHandle) {
  const bundle = await handle.fetchUrl(handle.server.bundleUrl);
  const state = /__VIFX_HMR_STATE=(\{[^}]*\});/u.exec(bundle.body.slice(0, 2000))?.[1];
  if (!state) {
    throw new Error("The served bundle does not declare its HMR state.");
  }
  return { bundle: bundle.body, state: JSON.parse(state) as { seq: number; session: string } };
}

ENGINE_TEST(
  "a save reaches a connected app as a patch keyed by project-relative module ids",
  async () => {
    const reports: VifxRebuildReport[] = [];
    await withServer({ onRebuild: (report) => reports.push(report) }, async (handle, project) => {
      const { state } = await readBundleState(handle);
      const app = await connectApp(handle);
      try {
        app.send({ ...state, clientId: "test-app", type: "vifx:hello" });
        // Registration is asynchronous; a save racing it would not be patched.
        await sleep(200);

        await writeFile(path.join(project.projectRoot, "index.js"), ENTRY_SOURCE("edited once"));
        const patch = await app.next("vifx:patch");

        // The Fast Refresh wrapper keys modules by project-relative path: the
        // engine must use the same ids wherever the server was started from
        // (this test runs from the package directory, not the project).
        expect(patch.body?.changedIds).toEqual(["index.js"]);
        expect(patch.body?.seq).toBe(1);
        expect(String(patch.body?.code)).toContain("edited once");

        // The report waits for the app to say what it did with the patch.
        expect(reports).toEqual([]);
        app.send({ filename: patch.body?.filename, rerun: 1, type: "vifx:delivered" });
        const report = await waitUntil(() => reports[0], "the update report");
        expect(report).toMatchObject({
          changedPaths: ["index.js"],
          engine: true,
          hmr: "fast-refresh",
          moduleCount: 1,
        });

        // An app that reloads instead says why, and the report carries it.
        await writeFile(path.join(project.projectRoot, "index.js"), ENTRY_SOURCE("edited twice"));
        await app.next("vifx:patch", app.messages.indexOf(patch) + 1);
        app.send({ reason: "No root boundary", type: "vifx:reload" });
        const reloadReport = await waitUntil(() => reports[1], "the reload report");
        expect(reloadReport).toMatchObject({
          changedPaths: ["index.js"],
          hmr: "reload",
          reason: "No root boundary",
        });
      } finally {
        app.close();
      }
    });
  },
);

ENGINE_TEST(
  "an app that cannot be patched is told to reload instead of being registered",
  async () => {
    await withServer({}, async (handle, project) => {
      const { state } = await readBundleState(handle);

      // Its bundle came from another server process.
      const stranger = await connectApp(handle);
      // It runs this server's bundle, connected and up to date.
      const current = await connectApp(handle);
      try {
        stranger.send({ clientId: "stranger", seq: 0, session: "another-run", type: "vifx:hello" });
        expect((await stranger.next("vifx:reload")).body?.reason).toBe("The dev server restarted");

        current.send({ ...state, clientId: "current", type: "vifx:hello" });
        await sleep(200);
        await writeFile(path.join(project.projectRoot, "index.js"), ENTRY_SOURCE("saved"));
        await current.next("vifx:patch");
        // Only the registered app is patched.
        expect(stranger.messages.some((message) => message.type === "vifx:patch")).toBe(false);

        // An app that was away during that save comes back one save behind.
        const late = await connectApp(handle);
        try {
          late.send({ ...state, clientId: "late", type: "vifx:hello" });
          expect((await late.next("vifx:reload")).body?.reason).toBe(
            "The app missed an update while it was disconnected",
          );
        } finally {
          late.close();
        }
      } finally {
        stranger.close();
        current.close();
      }
    });
  },
);

ENGINE_TEST("assets stay served after the engine has rebuilt the bundle", async () => {
  await withServer({}, async (handle, project) => {
    const before = await handle.get("/assets/icon.png");
    expect(before.status).toBe(200);

    // The engine empties its output directory on every build and only
    // re-emits the assets of the modules it loaded again.
    await writeFile(path.join(project.projectRoot, "index.js"), ENTRY_SOURCE("rebuilt"));
    await waitUntil(
      async () =>
        (await handle.fetchUrl(handle.server.bundleUrl)).body.includes("rebuilt")
          ? true
          : undefined,
      "the rebuilt bundle",
    );

    const after = await handle.get("/assets/icon.png");
    expect(after.status).toBe(200);
    expect(after.body).toBe(before.body);
  });
});

for (const [label, overrides] of [
  ["dev engine", {}],
  ["classic build", { devEngine: false }],
] as const) {
  ENGINE_TEST(`/symbolicate maps a statement to its exact source line (${label})`, async () => {
    await withServer(overrides, async (handle) => {
      const bundle = (await handle.fetchUrl(handle.server.bundleUrl)).body;
      const lines = bundle.split("\n");
      const lineIndex = lines.findIndex((line) => line.includes('"vifx harness runtime asset"'));
      expect(lineIndex).toBeGreaterThan(-1);

      const response = await handle.postJson("/symbolicate", {
        stack: [
          {
            column: (lines[lineIndex] ?? "").indexOf("console.log") + 1,
            file: "index.bundle",
            lineNumber: lineIndex + 1,
          },
        ],
      });
      const frame = response.json<{ stack: Array<{ lineNumber?: number; source?: string }> }>()
        .stack[0];

      // The bundle runs inside a wrapper function and behind a one-line
      // prelude: neither may shift the mapping.
      expect(frame?.source?.endsWith("index.js")).toBe(true);
      expect(frame?.lineNumber).toBe(ENTRY_LOG_LINE);
    });
  });
}

ENGINE_TEST("a server started on a project that does not compile recovers on save", async () => {
  const project = await createExpoGoTestProject();
  await writeFile(path.join(project.projectRoot, "index.js"), "const broken = ;\n");
  const errors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  const server = await startExpoGoDevServer({
    entry: "./index.js",
    lazyStart: true,
    platform: "ios",
    port: 0,
    projectRoot: project.projectRoot,
  });
  try {
    // The server is up and says what is wrong, once, without stack traces.
    const failed = await fetch(server.bundleUrl);
    expect(failed.status).toBe(500);
    const failure = await failed.text();
    expect(failure).toContain("vifx could not build the bundle.");
    expect(failure).toContain("index.js");
    expect(failure).not.toMatch(/^\s+at .+:\d+:\d+\)?$/mu);
    expect(errors.filter((message) => message.includes("failed to build"))).toHaveLength(1);

    // Fixing the file is enough: no restart.
    await writeFile(path.join(project.projectRoot, "index.js"), ENTRY_SOURCE("fixed"));
    const recovered = await waitUntil(async () => {
      const response = await fetch(server.bundleUrl);
      const body = await response.text();
      return response.status === 200 ? body : undefined;
    }, "the bundle to build after the fix");
    expect(recovered).toContain("fixed");
  } finally {
    console.error = originalConsoleError;
    await server.close();
    await rm(project.projectRoot, { force: true, recursive: true });
  }
});
