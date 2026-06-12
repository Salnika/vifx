import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import type { VifxBundleWatcherEvent } from "../src/watch.ts";
import { createBundleWatcher } from "../src/watch.ts";

async function createTempProjectRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "vifx-watch-test-"));
}

/**
 * A root path that never exists on disk. The watcher degrades to its
 * synthetic-driver mode (`notify()` only), which keeps debounce, serialization
 * and ignore-rule tests deterministic: real recursive watchers (FSEvents on
 * macOS in particular) can replay spurious events for freshly created
 * directories.
 */
function createVirtualProjectRoot() {
  return path.join(
    os.tmpdir(),
    `vifx-watch-virtual-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out while waiting for a watcher condition.");
    }

    await sleep(10);
  }
}

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

test("createBundleWatcher coalesces a burst of changes into one debounced rebuild", async () => {
  const rebuilds: string[][] = [];
  const events: VifxBundleWatcherEvent[] = [];
  const watcher = await createBundleWatcher({
    debounceMs: 25,
    onEvent: (event) => {
      events.push(event);
      if (event.type === "rebuild-start") {
        rebuilds.push(event.changedPaths);
      }
    },
    projectRoot: createVirtualProjectRoot(),
    rebuild: () => {},
  });

  try {
    watcher.notify("App.tsx");
    watcher.notify("App.tsx");
    watcher.notify("components/Button.tsx");

    await waitFor(() => events.some((event) => event.type === "rebuild-done"));
    await sleep(80);

    expect(rebuilds).toHaveLength(1);
    expect(rebuilds[0]).toEqual(["App.tsx", "components/Button.tsx"]);
    expect(events.filter((event) => event.type === "rebuild-done")).toHaveLength(1);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher debounce restarts while changes keep arriving", async () => {
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 60,
    projectRoot: createVirtualProjectRoot(),
    rebuild: () => {
      rebuildCount += 1;
    },
  });

  try {
    watcher.notify("a.ts");
    await sleep(30);
    watcher.notify("b.ts");
    await sleep(30);
    watcher.notify("c.ts");

    expect(rebuildCount).toBe(0);

    await waitFor(() => rebuildCount > 0);
    await sleep(120);

    expect(rebuildCount).toBe(1);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher serializes rebuilds and coalesces in-flight changes into one trailing run", async () => {
  const firstRebuildStarted = createDeferred();
  const firstRebuildGate = createDeferred();
  const rebuilds: string[][] = [];
  let activeRebuilds = 0;
  let maxConcurrentRebuilds = 0;
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 10,
    onEvent: (event) => {
      if (event.type === "rebuild-start") {
        rebuilds.push(event.changedPaths);
      }
    },
    projectRoot: createVirtualProjectRoot(),
    rebuild: async () => {
      activeRebuilds += 1;
      maxConcurrentRebuilds = Math.max(maxConcurrentRebuilds, activeRebuilds);
      rebuildCount += 1;

      if (rebuildCount === 1) {
        firstRebuildStarted.resolve();
        await firstRebuildGate.promise;
      }

      activeRebuilds -= 1;
    },
  });

  try {
    watcher.notify("first.ts");
    await firstRebuildStarted.promise;

    // These arrive while the first rebuild is still running and must coalesce
    // into exactly one trailing rebuild.
    watcher.notify("second.ts");
    watcher.notify("third.ts");
    await sleep(50);

    expect(rebuildCount).toBe(1);

    firstRebuildGate.resolve();
    await waitFor(() => rebuildCount === 2);
    await sleep(80);

    expect(rebuildCount).toBe(2);
    expect(maxConcurrentRebuilds).toBe(1);
    expect(rebuilds).toEqual([["first.ts"], ["second.ts", "third.ts"]]);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher reports rebuild failures and keeps rebuilding afterwards", async () => {
  const events: VifxBundleWatcherEvent[] = [];
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 10,
    onEvent: (event) => events.push(event),
    projectRoot: createVirtualProjectRoot(),
    rebuild: () => {
      rebuildCount += 1;
      if (rebuildCount === 1) {
        throw new Error("first rebuild failed");
      }
    },
  });

  try {
    watcher.notify("broken.ts");
    await waitFor(() => events.some((event) => event.type === "rebuild-error"));

    watcher.notify("fixed.ts");
    await waitFor(() => events.some((event) => event.type === "rebuild-done"));

    const errorEvent = events.find((event) => event.type === "rebuild-error");
    expect(errorEvent?.type === "rebuild-error" && errorEvent.error).toBeInstanceOf(Error);
    expect(rebuildCount).toBe(2);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher ignores generated, hidden, and explicitly excluded paths", async () => {
  const projectRoot = createVirtualProjectRoot();
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 10,
    ignore: [".vifx/expo-go/ios", "custom-out"],
    projectRoot,
    rebuild: () => {
      rebuildCount += 1;
    },
  });

  try {
    watcher.notify("node_modules/react/index.js");
    watcher.notify(".git/HEAD");
    watcher.notify(".vifx/expo-go/ios/index.bundle");
    watcher.notify("dist/index.js");
    watcher.notify(".env.local");
    watcher.notify("src/.hidden/file.ts");
    watcher.notify("custom-out/index.bundle");
    watcher.notify(path.join(projectRoot, "custom-out", "nested", "chunk.js"));
    watcher.notify("../outside/the/project.ts");
    await sleep(80);

    expect(rebuildCount).toBe(0);

    watcher.notify("src/App.tsx");
    await waitFor(() => rebuildCount === 1);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher stops scheduling rebuilds after close", async () => {
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 10,
    projectRoot: createVirtualProjectRoot(),
    rebuild: () => {
      rebuildCount += 1;
    },
  });

  watcher.notify("pending.ts");
  await watcher.close();
  watcher.notify("after-close.ts");
  await sleep(80);

  expect(rebuildCount).toBe(0);
});

test("createBundleWatcher degrades gracefully when the watch root is missing", async () => {
  const events: VifxBundleWatcherEvent[] = [];
  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 10,
    onEvent: (event) => events.push(event),
    projectRoot: createVirtualProjectRoot(),
    rebuild: () => {
      rebuildCount += 1;
    },
  });

  try {
    expect(watcher.watching).toBe(false);
    expect(events.some((event) => event.type === "watch-error")).toBe(true);

    // Synthetic notifications keep driving rebuilds even without fs watching.
    watcher.notify("manual.ts");
    await waitFor(() => rebuildCount === 1);
  } finally {
    await watcher.close();
  }
});

test("createBundleWatcher picks up real filesystem changes recursively", async () => {
  const projectRoot = await createTempProjectRoot();
  const sourceDir = path.join(projectRoot, "src", "components");
  await mkdir(sourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, "Button.tsx");
  await writeFile(sourcePath, "export const Button = 1;\n");

  let rebuildCount = 0;
  const watcher = await createBundleWatcher({
    debounceMs: 25,
    projectRoot,
    rebuild: () => {
      rebuildCount += 1;
    },
  });

  try {
    expect(watcher.watching).toBe(true);

    // Recursive watchers can take a moment to arm; keep touching the file
    // until the first change is observed.
    const deadline = Date.now() + 10_000;
    let revision = 0;
    while (rebuildCount === 0 && Date.now() < deadline) {
      revision += 1;
      await writeFile(sourcePath, `export const Button = ${String(revision)};\n`);
      await sleep(200);
    }

    expect(rebuildCount).toBeGreaterThan(0);
  } finally {
    await watcher.close();
    await rm(projectRoot, { force: true, recursive: true });
  }
}, 20_000);
