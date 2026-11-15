#!/usr/bin/env node
// Benchmarks Expo's bundler (Metro, through the project's own `expo` CLI)
// against vifx on one Expo project.
//
//   node scripts/bench/expo-vs-vifx.mjs --project <path> [options]
//
// Phases:
//   embed   `export:embed` for each platform x flavor (release, dev): one cold
//           run (caches cleared) then N warm runs. Wall time, peak RSS, bundle /
//           gzip / source-map size, module count, assets, Hermes bytecode.
//   server  dev server: time from process start to the first bundle served, a
//           repeat fetch, and N "edit a file -> new bundle available" cycles.
//
// Both tools run on the same checkout, same machine, one after the other. The
// project is never modified except for the file named by --edit-file, which is
// restored after each cycle. Requires a built vifx (`pnpm build`).

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIFX_BIN = path.join(REPO_ROOT, "packages/cli/dist/bin.mjs");

const { values: flags } = parseArgs({
  options: {
    // Override vifx's Babel worker count (sets VIFX_BABEL_WORKERS; 0 disables the pool).
    "babel-workers": { type: "string" },
    "edit-file": { type: "string" },
    entry: { type: "string" },
    flavors: { default: "release,dev", type: "string" },
    out: { type: "string" },
    phases: { default: "embed,server", type: "string" },
    platforms: { default: "ios,android", type: "string" },
    // Print vifx's own hook-time breakdown for each build (sets VIFX_PROFILE=1).
    profile: { default: false, type: "boolean" },
    project: { type: "string" },
    runs: { default: "3", type: "string" },
    tools: { default: "metro,vifx", type: "string" },
  },
});

if (!flags.project) {
  console.error("Missing --project <path to an installed Expo project>.");
  process.exit(2);
}

const project = path.resolve(flags.project);
const outDir = path.resolve(flags.out ?? path.join(REPO_ROOT, ".bench", path.basename(project)));
const runs = Math.max(1, Number.parseInt(flags.runs, 10) || 3);
const list = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const platforms = list(flags.platforms);
const flavors = list(flags.flavors);
const phases = list(flags.phases);
const tools = list(flags.tools);

// Metro's file crawler shells out to `find` by name. A wrapper earlier on PATH
// (shell tooling, agent harness shims) that is not the real utility makes the
// crawl come back empty, and Metro then fails to resolve every module. Putting
// the system directories first guarantees both bundlers get the real ones.
const SYSTEM_PATH =
  process.platform === "win32"
    ? process.env.PATH
    : ["/usr/bin", "/bin", process.env.PATH].filter(Boolean).join(":");

const BASE_ENV = {
  ...process.env,
  PATH: SYSTEM_PATH,
  ...(flags.profile ? { VIFX_PROFILE: "1" } : {}),
  ...(flags["babel-workers"] === undefined ? {} : { VIFX_BABEL_WORKERS: flags["babel-workers"] }),
  EXPO_NO_TELEMETRY: "1",
  EXPO_OFFLINE: "1",
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};

const yesNo = (value) => (value === true ? "yes" : value === false ? "NO" : "—");
const median = (numbers) => {
  const sorted = [...numbers].sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
};
const round = (value) => (value === null || value === undefined ? null : Math.round(value));
const log = (message) => console.error(`[bench] ${message}`);

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** Peak resident set size from `/usr/bin/time` output (largest process of the tree). */
function parsePeakRss(stderr) {
  const macos = stderr.match(/(\d+)\s+maximum resident set size/u);
  if (macos) {
    return Number(macos[1]);
  }
  const linux = stderr.match(/Maximum resident set size \(kbytes\): (\d+)/u);
  return linux ? Number(linux[1]) * 1024 : null;
}

/** Keeps the message lines of a failed run: no stack frames, no `time` statistics. */
function summarizeOutput(output) {
  return output
    .split("\n")
    .filter(
      (line) =>
        line.trim() !== "" &&
        !/^\s+at\s/u.test(line) &&
        !/^\s+\d+(\.\d+)?\s+(real|maximum|average|page|swaps|block|messages|signals|voluntary|involuntary|instructions|cycles|peak)\b/u.test(
          line,
        ),
    )
    .join("\n")
    .slice(0, 2500);
}

/**
 * Resident memory of `rootPid` and all of its descendants, summed from one
 * `ps` snapshot. `/usr/bin/time` only reports the largest single process, which
 * hides a bundler that spreads its work over child processes (Metro's
 * transform workers); worker threads, by contrast, are counted in full there.
 * The tree total is the comparable number.
 */
function sampleTreeRssBytes(rootPid) {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axo", "pid=,ppid=,rss="], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const childrenByParent = new Map();
      const rssByPid = new Map();
      for (const line of stdout.split("\n")) {
        const [pid, ppid, rss] = line.trim().split(/\s+/u).map(Number);
        if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rss)) {
          continue;
        }
        rssByPid.set(pid, rss);
        const siblings = childrenByParent.get(ppid) ?? [];
        siblings.push(pid);
        childrenByParent.set(ppid, siblings);
      }
      let totalKb = 0;
      const pending = [rootPid];
      while (pending.length > 0) {
        const pid = pending.pop();
        totalKb += rssByPid.get(pid) ?? 0;
        pending.push(...(childrenByParent.get(pid) ?? []));
      }
      resolve(totalKb * 1024);
    });
  });
}

/** Runs a command to completion under `/usr/bin/time`, capturing wall time and peak RSS. */
function runTimed(command, args, { cwd, env = BASE_ENV } = {}) {
  const timeFlag = process.platform === "darwin" ? "-l" : "-v";
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const child = spawn("/usr/bin/time", [timeFlag, command, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let treePeakRssBytes = null;
    let sampling = false;
    const sampler =
      process.platform === "win32" || child.pid === undefined
        ? null
        : setInterval(() => {
            if (sampling) {
              return;
            }
            sampling = true;
            void sampleTreeRssBytes(child.pid).then((bytes) => {
              sampling = false;
              if (bytes !== null && bytes > (treePeakRssBytes ?? 0)) {
                treePeakRssBytes = bytes;
              }
            });
          }, 100);
    child.stdout.on("data", (chunk) => (stdout = (stdout + chunk).slice(-20_000)));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-40_000)));
    child.on("close", (exitCode) => {
      if (sampler !== null) {
        clearInterval(sampler);
      }
      for (const line of stderr.split("\n")) {
        if (line.includes("[vifx profile]")) {
          log(line.trim());
        }
      }
      resolve({
        exitCode,
        ok: exitCode === 0,
        output: summarizeOutput(`${stdout}\n${stderr}`),
        peakRssBytes: parsePeakRss(stderr),
        treePeakRssBytes,
        wallMs: performance.now() - startedAt,
      });
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function walkFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  const files = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(path.join(entry.parentPath ?? directory, entry.name));
    }
  }
  return files;
}

async function fileSize(filePath) {
  return (await stat(filePath).catch(() => null))?.size ?? null;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function embedCommand(tool, { cold, dev, outputs, platform }) {
  const shared = [
    "--platform",
    platform,
    "--dev",
    String(dev),
    "--bundle-output",
    outputs.bundle,
    "--sourcemap-output",
    outputs.map,
    "--assets-dest",
    outputs.assets,
    ...(flags.entry ? ["--entry-file", flags.entry] : []),
  ];

  if (tool === "metro") {
    return {
      args: ["export:embed", ...shared, ...(cold ? ["--reset-cache"] : [])],
      command: path.join(project, "node_modules/.bin/expo"),
    };
  }

  return { args: [VIFX_BIN, "export:embed", project, ...shared], command: process.execPath };
}

function envFor(_tool) {
  return BASE_ENV;
}

/**
 * Clears the tool's on-disk caches so the next run is a true cold build.
 *
 * Metro keeps its caches under the OS temp directory, shared with every other
 * process, so nothing is deleted there: Metro's own `--reset-cache` flag (passed
 * on cold runs) is what empties its transform cache. Pointing Metro at a private
 * TMPDIR was tried and rejected — it breaks Metro's file crawl.
 */
async function clearCaches(tool) {
  if (tool === "vifx") {
    // vifx-owned directory inside the project: transform cache + build outputs.
    await rm(path.join(project, ".vifx"), { force: true, recursive: true });
  }
}

function findHermesc() {
  const binDir =
    process.platform === "darwin"
      ? "osx-bin"
      : process.platform === "win32"
        ? "win64-bin"
        : "linux64-bin";
  const candidates = [
    path.join(project, "node_modules/hermes-compiler/hermesc", binDir, "hermesc"),
    path.join(project, "node_modules/react-native/sdks/hermesc", binDir, "hermesc"),
    path.join(
      project,
      "node_modules/react-native/node_modules/hermes-compiler/hermesc",
      binDir,
      "hermesc",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function describeArtifacts(outputs) {
  const bundle = await readFile(outputs.bundle).catch(() => null);
  const mapText = await readFile(outputs.map, "utf8").catch(() => null);
  let moduleCount = null;
  if (mapText) {
    const map = JSON.parse(mapText);
    const sources = map.sections
      ? map.sections.flatMap((section) => section.map?.sources ?? [])
      : (map.sources ?? []);
    moduleCount = new Set(sources).size;
  }
  const assets = await walkFiles(outputs.assets);
  let assetBytes = 0;
  for (const asset of assets) {
    assetBytes += (await fileSize(asset)) ?? 0;
  }

  return {
    assetBytes,
    assetFiles: assets.length,
    bundleBytes: bundle?.length ?? null,
    bundleGzipBytes: bundle ? gzipSync(bundle).length : null,
    moduleCount,
    sourceMapBytes: mapText ? Buffer.byteLength(mapText) : null,
  };
}

// ---------------------------------------------------------------------------
// Phase: embed
// ---------------------------------------------------------------------------

async function benchEmbed() {
  const hermesc = findHermesc();
  const results = [];

  for (const platform of platforms) {
    for (const flavor of flavors) {
      for (const tool of tools) {
        const dev = flavor === "dev";
        const base = path.join(outDir, "embed", `${platform}-${flavor}`, tool);
        const outputs = {
          assets: path.join(base, "assets"),
          bundle: path.join(base, "main.jsbundle"),
          map: path.join(base, "main.jsbundle.map"),
        };
        const entry = { flavor, platform, tool, warmRuns: [] };
        results.push(entry);

        await rm(base, { force: true, recursive: true });
        await mkdir(base, { recursive: true });
        await clearCaches(tool);

        log(`${tool} ${platform} ${flavor}: cold`);
        const coldCommand = embedCommand(tool, { cold: true, dev, outputs, platform });
        const cold = await runTimed(coldCommand.command, coldCommand.args, {
          cwd: project,
          env: envFor(tool),
        });
        entry.cold = {
          ok: cold.ok,
          peakRssBytes: cold.peakRssBytes,
          treePeakRssBytes: cold.treePeakRssBytes,
          wallMs: round(cold.wallMs),
        };
        if (!cold.ok) {
          entry.error = cold.output;
          log(`${tool} ${platform} ${flavor}: FAILED (exit ${cold.exitCode})`);
          continue;
        }

        for (let index = 0; index < runs; index += 1) {
          log(`${tool} ${platform} ${flavor}: warm ${index + 1}/${runs}`);
          const warmCommand = embedCommand(tool, { cold: false, dev, outputs, platform });
          const warm = await runTimed(warmCommand.command, warmCommand.args, {
            cwd: project,
            env: envFor(tool),
          });
          if (!warm.ok) {
            entry.error = warm.output;
            break;
          }
          entry.warmRuns.push({
            peakRssBytes: warm.peakRssBytes,
            treePeakRssBytes: warm.treePeakRssBytes,
            wallMs: round(warm.wallMs),
          });
        }
        entry.warmMedianMs = median(entry.warmRuns.map((run) => run.wallMs));
        entry.warmPeakRssBytes = median(entry.warmRuns.map((run) => run.peakRssBytes ?? 0));
        entry.warmTreePeakRssBytes = median(entry.warmRuns.map((run) => run.treePeakRssBytes ?? 0));
        entry.artifacts = await describeArtifacts(outputs);

        if (hermesc && !dev) {
          const hbcPath = path.join(base, "main.hbc");
          const hermes = await runTimed(hermesc, [
            "-emit-binary",
            "-O",
            "-w",
            "-out",
            hbcPath,
            outputs.bundle,
          ]);
          entry.hermes = hermes.ok
            ? { hbcBytes: await fileSize(hbcPath), wallMs: round(hermes.wallMs) }
            : { error: hermes.output.slice(-600) };
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase: server
// ---------------------------------------------------------------------------

function serverCommand(tool, { cold, platform, port }) {
  if (tool === "metro") {
    return {
      // `--clear` is Expo's flag for starting with an empty bundler cache.
      args: ["start", "--port", String(port), "--localhost", ...(cold ? ["--clear"] : [])],
      command: path.join(project, "node_modules/.bin/expo"),
    };
  }
  return {
    args: [
      VIFX_BIN,
      "expo",
      "dev",
      project,
      "--platform",
      platform,
      "--expo-go",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--json",
    ],
    command: process.execPath,
  };
}

async function fetchManifestBundleUrl(baseUrl, platform) {
  const response = await fetch(`${baseUrl}/`, {
    headers: {
      accept: "application/expo+json,application/json",
      "expo-platform": platform,
    },
  });
  if (!response.ok) {
    throw new Error(`manifest HTTP ${response.status}`);
  }
  const text = await response.text();
  // Expo may answer multipart; the manifest JSON is the first `{...}` block.
  const manifest = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const url = manifest.launchAsset?.url ?? manifest.bundleUrl;
  if (!url) {
    throw new Error("manifest has no launchAsset.url");
  }
  return url.replace(/^(https?:\/\/)[^/]+/u, baseUrl);
}

async function fetchBundle(url) {
  const startedAt = performance.now();
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`bundle HTTP ${response.status}: ${body.slice(0, 400)}`);
  }
  return { body, bytes: Buffer.byteLength(body), ms: performance.now() - startedAt };
}

/**
 * Waits until the dev server answers `/status` and returns the base URL it
 * answered on. `expo start --localhost` listens on `localhost`, which resolves
 * to `::1` alone on some machines, so both loopback addresses are tried.
 */
async function waitForStatus(port, child, timeoutMs) {
  const candidates = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited with code ${child.exitCode}`);
    }
    for (const baseUrl of candidates) {
      const ok = await fetch(`${baseUrl}/status`)
        .then((response) => response.ok)
        .catch(() => false);
      if (ok) {
        return baseUrl;
      }
    }
    await sleep(100);
  }
  throw new Error("dev server did not answer /status in time");
}

/**
 * One dev-server session. `cold` starts from empty caches; the warm session
 * that follows reuses them and also runs the edit cycles.
 */
async function benchServerFor(tool, platform, { cold }) {
  const port = await findFreePort();
  const { args, command } = serverCommand(tool, { cold, platform, port });
  const entry = { edits: [], hmrEdits: [] };
  const editFile = !cold && flags["edit-file"] ? path.resolve(project, flags["edit-file"]) : null;
  const originalSource = editFile ? await readFile(editFile, "utf8") : null;

  if (cold) {
    await clearCaches(tool);
  }
  const startedAt = performance.now();
  const child = spawn(command, args, {
    cwd: project,
    detached: true,
    env: envFor(tool),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output = (output + chunk).slice(-4000)));
  child.stderr.on("data", (chunk) => (output = (output + chunk).slice(-4000)));

  try {
    const baseUrl = await waitForStatus(port, child, 600_000);
    entry.readyMs = round(performance.now() - startedAt);
    const bundleUrl = await fetchManifestBundleUrl(baseUrl, platform);
    const first = await fetchBundle(bundleUrl);
    entry.firstBundleMs = round(performance.now() - startedAt);
    entry.firstBundleBytes = first.bytes;
    entry.repeatFetchMs = round((await fetchBundle(bundleUrl)).ms);

    if (editFile && originalSource !== null) {
      // Fast Refresh: how long a save takes to reach a connected app, measured
      // on the `/hot` socket the app itself listens on.
      // What the app's JS engine will have to parse: the served bundle and,
      // below, a Fast Refresh patch.
      entry.hermesParsesBundle = await hermesParses(first.body, `${tool}-${platform}-bundle`);

      const hot = await openHotSocket(baseUrl, tool, bundleUrl).catch(() => null);
      if (hot) {
        for (let index = 0; index < runs; index += 1) {
          const update = hot.waitForUpdate(30_000);
          const editedAt = performance.now();
          await writeFile(
            editFile,
            `${originalSource}\nglobalThis.__vifxBench = "hmr_${Date.now()}_${index}";\n`,
            "utf8",
          );
          const receivedAt = await update;
          entry.hmrEdits.push(receivedAt === null ? null : round(receivedAt - editedAt));
          const restored = hot.waitForUpdate(10_000);
          await writeFile(editFile, originalSource, "utf8");
          await restored;
          await sleep(500);
        }
        hot.close();
        entry.hmrMedianMs = median(entry.hmrEdits.filter((value) => value !== null));
        const patchCode = hot.lastUpdateCode();
        if (patchCode !== null) {
          entry.hermesParsesPatch = await hermesParses(patchCode, `${tool}-${platform}-patch`);
        }
      }

      for (let index = 0; index < runs; index += 1) {
        const marker = `vifx_bench_${Date.now()}_${index}`;
        const editedAt = performance.now();
        await writeFile(
          editFile,
          `${originalSource}\nglobalThis.__vifxBench = ${JSON.stringify(marker)};\n`,
          "utf8",
        );
        let updatedMs = null;
        while (performance.now() - editedAt < 180_000) {
          const bundle = await fetchBundle(bundleUrl).catch(() => null);
          if (bundle?.body.includes(marker)) {
            updatedMs = performance.now() - editedAt;
            break;
          }
          await sleep(50);
        }
        entry.edits.push(round(updatedMs));
        await writeFile(editFile, originalSource, "utf8");
        await sleep(1500);
      }
      entry.editMedianMs = median(entry.edits.filter((value) => value !== null));
    }
  } catch (error) {
    entry.error = `${error instanceof Error ? error.message : String(error)}\n${output.slice(-1500)}`;
  } finally {
    for (const line of output.split("\n")) {
      if (line.includes("[vifx profile]")) {
        log(line.trim());
      }
    }
    if (editFile && originalSource !== null) {
      await writeFile(editFile, originalSource, "utf8");
    }
    try {
      // Negative pid: signal the whole process group the server was started in.
      if (child.pid !== undefined) {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      // Already gone.
    }
    await sleep(1000);
  }

  return entry;
}

/**
 * Connects to the dev server's `/hot` socket the way the app does: Metro's
 * client registers the bundle it runs, vifx's introduces itself to the dev
 * engine. `waitForUpdate` resolves with the time a module update arrived.
 */
async function openHotSocket(baseUrl, tool, bundleUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/hot`);
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    for (const listener of listeners) {
      listener(message);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("hot socket failed")), {
      once: true,
    });
  });

  const waitFor = (matches, timeoutMs) =>
    new Promise((resolve) => {
      const listener = (message) => {
        if (!matches(message)) {
          return;
        }
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(performance.now());
      };
      const timer = setTimeout(() => {
        listeners.delete(listener);
        resolve(null);
      }, timeoutMs);
      listeners.add(listener);
    });

  if (tool === "metro") {
    const registered = waitFor((message) => message.type === "bundle-registered", 60_000);
    socket.send(JSON.stringify({ entryPoints: [bundleUrl], type: "register-entrypoints" }));
    await registered;
  } else {
    // The app says which bundle it runs (server session + saves included), as
    // read from the bundle's prelude; the server only patches a current app.
    const bundleHead = (await (await fetch(bundleUrl)).text()).slice(0, 2000);
    const state = JSON.parse(/__VIFX_HMR_STATE=(\{[^}]*\});/u.exec(bundleHead)?.[1] ?? "{}");
    socket.send(JSON.stringify({ ...state, clientId: "vifx-bench", type: "vifx:hello" }));
    await sleep(300);
  }

  let lastUpdateCode = null;
  return {
    close: () => socket.close(),
    /** Code of the last module update received (what the app evaluates). */
    lastUpdateCode: () => lastUpdateCode,
    waitForUpdate: (timeoutMs) =>
      waitFor((message) => {
        if (message.type === "vifx:patch") {
          lastUpdateCode = message.body?.code ?? null;
          // What the app does once it has evaluated the patch.
          socket.send(JSON.stringify({ filename: message.body?.filename, type: "vifx:delivered" }));
          return true;
        }
        const body = message.type === "update" ? message.body : null;
        const modules = [...(body?.modified ?? []), ...(body?.added ?? [])];
        if (modules.length === 0) {
          return false;
        }
        lastUpdateCode = modules.map((module) => module.module?.[1] ?? "").join("\n");
        return true;
      }, timeoutMs),
  };
}

/**
 * Whether the project's Hermes compiler accepts `code`. `null` when the
 * project ships no Hermes compiler to ask.
 */
async function hermesParses(code, label) {
  const hermesc = findHermesc();
  if (!hermesc) {
    return null;
  }
  const checkDir = path.join(outDir, "hermes-check");
  await mkdir(checkDir, { recursive: true });
  const sourcePath = path.join(checkDir, `${label}.js`);
  await writeFile(sourcePath, code, "utf8");
  const result = await runTimed(hermesc, [
    "-emit-binary",
    "-w",
    "-out",
    path.join(checkDir, `${label}.hbc`),
    sourcePath,
  ]);
  if (!result.ok) {
    log(`${label}: Hermes rejected the code\n${result.output.slice(0, 600)}`);
  }
  return result.ok;
}

async function benchServer() {
  const results = [];
  for (const platform of platforms) {
    for (const tool of tools) {
      log(`${tool} ${platform}: dev server, cold start`);
      const cold = await benchServerFor(tool, platform, { cold: true });
      log(`${tool} ${platform}: dev server, warm start + edits`);
      const warm = await benchServerFor(tool, platform, { cold: false });
      results.push({
        cold,
        editMedianMs: warm.editMedianMs ?? null,
        edits: warm.edits,
        hmrEdits: warm.hmrEdits,
        hmrMedianMs: warm.hmrMedianMs ?? null,
        error: cold.error ?? warm.error,
        platform,
        tool,
        warm,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const mb = (bytes) =>
  bytes === null || bytes === undefined ? "—" : `${(bytes / 1e6).toFixed(2)} MB`;
const seconds = (ms) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(2)} s`);
const count = (value) => (value === null || value === undefined ? "—" : String(value));

function ratio(metro, vifx) {
  if (!metro || !vifx) {
    return "—";
  }
  const delta = ((vifx - metro) / metro) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function renderReport(result) {
  const lines = [
    `# Expo (Metro) vs vifx — ${result.project.name}`,
    "",
    `- Date: ${result.date}`,
    `- Project: ${result.project.name} ${result.project.version ?? ""} — Expo ${result.project.expo}, React Native ${result.project.reactNative}`,
    `- Machine: ${result.machine.cpu} (${result.machine.cores} cores), ${result.machine.memoryGb} GB, ${result.machine.os}, Node ${result.machine.node}`,
    `- Warm runs per cell: ${result.runs} (median reported). Delta = vifx relative to Metro.`,
    "",
  ];

  const pair = (rows, platform, flavor) => ({
    metro: rows.find(
      (row) => row.tool === "metro" && row.platform === platform && row.flavor === flavor,
    ),
    vifx: rows.find(
      (row) => row.tool === "vifx" && row.platform === platform && row.flavor === flavor,
    ),
  });

  if (result.embed) {
    for (const platform of platforms) {
      for (const flavor of flavors) {
        const { metro, vifx } = pair(result.embed, platform, flavor);
        const row = (label, pick, format) =>
          `| ${label} | ${format(pick(metro))} | ${format(pick(vifx))} | ${ratio(pick(metro), pick(vifx))} |`;
        lines.push(
          `## \`export:embed\` — ${platform}, ${flavor}`,
          "",
          "| Metric | Metro | vifx | Delta |",
          "| --- | --- | --- | --- |",
          row("Cold build", (entry) => entry?.cold?.wallMs, seconds),
          row("Warm build (median)", (entry) => entry?.warmMedianMs, seconds),
          row("Peak memory, cold (process tree)", (entry) => entry?.cold?.treePeakRssBytes, mb),
          row("Peak memory, warm (process tree)", (entry) => entry?.warmTreePeakRssBytes, mb),
          row("Largest process, cold", (entry) => entry?.cold?.peakRssBytes, mb),
          row("Largest process, warm", (entry) => entry?.warmPeakRssBytes, mb),
          row("JS bundle", (entry) => entry?.artifacts?.bundleBytes, mb),
          row("JS bundle, gzip", (entry) => entry?.artifacts?.bundleGzipBytes, mb),
          row("Source map", (entry) => entry?.artifacts?.sourceMapBytes, mb),
          row("Modules (source-map sources)", (entry) => entry?.artifacts?.moduleCount, count),
          row("Asset files", (entry) => entry?.artifacts?.assetFiles, count),
          ...(flavor === "release"
            ? [
                row("Hermes bytecode", (entry) => entry?.hermes?.hbcBytes, mb),
                row("Hermes compile", (entry) => entry?.hermes?.wallMs, seconds),
              ]
            : []),
          "",
        );
        for (const entry of [metro, vifx]) {
          if (entry?.error) {
            lines.push(
              `> **${entry.tool} failed:**`,
              "",
              "```",
              entry.error.slice(0, 1500),
              "```",
              "",
            );
          }
        }
      }
    }
  }

  if (result.server) {
    lines.push(
      "## Dev server",
      "",
      "| Platform | Metric | Metro | vifx | Delta |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const platform of platforms) {
      const metro = result.server.find((row) => row.tool === "metro" && row.platform === platform);
      const vifx = result.server.find((row) => row.tool === "vifx" && row.platform === platform);
      const row = (label, pick, format = seconds) =>
        `| ${platform} | ${label} | ${format(pick(metro))} | ${format(pick(vifx))} | ${ratio(pick(metro), pick(vifx))} |`;
      lines.push(
        row("Cold start → server answering", (entry) => entry?.cold?.readyMs),
        row("Cold start → first bundle served", (entry) => entry?.cold?.firstBundleMs),
        row("Warm start → server answering", (entry) => entry?.warm?.readyMs),
        row("Warm start → first bundle served", (entry) => entry?.warm?.firstBundleMs),
        row("Repeat bundle fetch", (entry) => entry?.warm?.repeatFetchMs),
        row("Edit → Fast Refresh update received (median)", (entry) => entry?.hmrMedianMs),
        `| ${platform} | Dev bundle / update accepted by Hermes | ${yesNo(metro?.warm?.hermesParsesBundle)} / ${yesNo(metro?.warm?.hermesParsesPatch)} | ${yesNo(vifx?.warm?.hermesParsesBundle)} / ${yesNo(vifx?.warm?.hermesParsesPatch)} | |`,
        row("Edit → new bundle available (median)", (entry) => entry?.editMedianMs),
        row("Dev bundle served", (entry) => entry?.warm?.firstBundleBytes, mb),
      );
    }
    lines.push("");
    for (const entry of result.server) {
      if (entry.error) {
        lines.push(
          `> **${entry.tool} ${entry.platform} dev server failed:**`,
          "",
          "```",
          entry.error.slice(-1200),
          "```",
          "",
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readProjectInfo() {
  const manifest = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  const installed = async (name) =>
    JSON.parse(
      await readFile(path.join(project, "node_modules", name, "package.json"), "utf8").catch(
        () => "{}",
      ),
    ).version ?? "?";
  return {
    expo: await installed("expo"),
    name: manifest.name,
    reactNative: await installed("react-native"),
    version: manifest.version,
  };
}

if (!existsSync(VIFX_BIN)) {
  console.error(`vifx is not built (${VIFX_BIN} is missing). Run \`pnpm build\` first.`);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
const result = {
  date: new Date().toISOString().slice(0, 10),
  machine: {
    cores: os.cpus().length,
    cpu: os.cpus()[0]?.model ?? "unknown",
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
  },
  project: await readProjectInfo(),
  runs,
};

if (phases.includes("embed")) {
  result.embed = await benchEmbed();
}
if (phases.includes("server")) {
  result.server = await benchServer();
}

const report = renderReport(result);
await writeFile(path.join(outDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "report.md"), report, "utf8");
console.log(report);
log(`results written to ${outDir}`);
