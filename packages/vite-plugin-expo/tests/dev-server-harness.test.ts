// Behavioral contract suite for the Expo Go dev server (`startExpoGoDevServer`).
//
// These tests document the server's *observable* contract endpoint-by-endpoint
// so that the sibling Metro-replacement rewrites can be validated against a
// fixed behavioral baseline. Assertion messages name the endpoint contract so a
// failure points directly at the broken guarantee.
//
// Scope is strictly the *current* behavior of `startExpoGoDevServer`: the bundle
// + source-map + manifest + asset HTTP routes, the `/status` packager probe, the
// `/symbolicate` endpoint, and the `/message` + `/events` WebSocket protocol
// (getid / getpeers / peer-to-peer routing / reload broadcast). Endpoints owned
// by sibling units (`/hot` HMR, the inspector proxy, multipart manifests) are
// intentionally NOT exercised here.
//
// Every test uses an ephemeral port (0) and is gated on `canListenOnLocalhost`
// so the suite self-skips in network-restricted sandboxes.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateSourceMap } from "@vifx/source-map-tools";
import { test } from "vite-plus/test";
import {
  canListenOnLocalhost,
  createExpoGoTestProject,
  type ExpoGoTestProject,
  startTestServer,
  type TestServerHandle,
} from "./harness.ts";

const CONTRACT_TEST = (await canListenOnLocalhost()) ? test : test.skip;

/**
 * Build a synthetic project + start the dev server, run `body`, then always tear
 * down (server + sockets + temp project). Keeps every test leak-free even when an
 * assertion throws.
 */
async function withServer(
  body: (handle: TestServerHandle, project: ExpoGoTestProject) => Promise<void>,
): Promise<void> {
  const project = await createExpoGoTestProject();
  const handle = await startTestServer(project);
  try {
    await body(handle, project);
  } finally {
    await handle.cleanup();
    await rm(project.projectRoot, { force: true, recursive: true });
  }
}

interface ExpoGoManifest {
  assets: Array<{
    fileExtension: string;
    fileUris: string[];
    hash: string | null;
    key: string;
    name: string;
    type: string;
    url: string;
  }>;
  extra: {
    expoClient: { hostUri: string; icon?: string; sdkVersion?: string; slug: string };
    expoGo: { debuggerHost: string; developer: { tool: string }; mainModuleName: string };
  };
  launchAsset: { contentType: string; fileExtension: string; url: string };
  metadata: { generatedBy: string; platform: string };
  runtimeVersion: string;
  sdkVersion?: string;
}

CONTRACT_TEST(
  "GET / + /manifest + /index.exp serve an Expo Go manifest with protocol headers and fetchable assets",
  async () => {
    await withServer(async (handle, project) => {
      for (const route of ["/", "/manifest", "/index.exp"]) {
        const response = await handle.get(route);
        if (response.status !== 200) {
          throw new Error(
            `GET ${route} manifest contract: expected 200, received ${String(response.status)}.`,
          );
        }
        if (response.headers.get("expo-protocol-version") === null) {
          throw new Error(
            `GET ${route} manifest contract: missing required \`expo-protocol-version\` header.`,
          );
        }
        if (response.headers.get("expo-sfv-version") === null) {
          throw new Error(
            `GET ${route} manifest contract: missing required \`expo-sfv-version\` header.`,
          );
        }
      }

      const manifest = (await handle.get("/manifest")).json<ExpoGoManifest>();

      if (!manifest.launchAsset?.url) {
        throw new Error("/manifest contract: `launchAsset.url` must point at the JS bundle.");
      }
      const launch = await handle.fetchUrl(manifest.launchAsset.url);
      if (launch.status !== 200) {
        throw new Error(
          `/manifest contract: launchAsset.url (${manifest.launchAsset.url}) must be fetchable, received ${String(
            launch.status,
          )}.`,
        );
      }
      if (launch.body.length === 0) {
        throw new Error("/manifest contract: launchAsset.url returned an empty bundle.");
      }

      if (!manifest.extra?.expoGo?.debuggerHost) {
        throw new Error("/manifest contract: `extra.expoGo.debuggerHost` must be present.");
      }
      if (!manifest.runtimeVersion) {
        throw new Error("/manifest contract: `runtimeVersion` must be present.");
      }

      const sampledAssetUrl = manifest.assets[0]?.url ?? manifest.assets[0]?.fileUris[0];
      if (!sampledAssetUrl) {
        throw new Error(
          "/manifest contract: expected at least one emitted asset (runtime PNG import) in `assets`.",
        );
      }
      const sampledAsset = await handle.fetchUrl(sampledAssetUrl);
      if (sampledAsset.status !== 200) {
        throw new Error(
          `/manifest contract: sampled asset URL (${sampledAssetUrl}) must be fetchable, received ${String(
            sampledAsset.status,
          )}.`,
        );
      }
      void project;
    });
  },
);

CONTRACT_TEST("GET /status returns the exact Metro packager-running sentinel", async () => {
  await withServer(async (handle) => {
    const response = await handle.get("/status");
    if (response.status !== 200) {
      throw new Error(`GET /status contract: expected 200, received ${String(response.status)}.`);
    }
    if (response.body !== "packager-status:running") {
      throw new Error(
        `GET /status contract: Expo Go expects the exact body "packager-status:running", received ${JSON.stringify(
          response.body,
        )}.`,
      );
    }
  });
});

CONTRACT_TEST("the bundle route serves a non-empty pre-bundled module graph", async () => {
  await withServer(async (handle) => {
    const manifest = (await handle.get("/manifest")).json<ExpoGoManifest>();
    const bundleUrl = manifest.launchAsset.url;
    const bundle = await handle.fetchUrl(bundleUrl);

    if (bundle.status !== 200) {
      throw new Error(
        `bundle route contract: expected 200 from ${bundleUrl}, received ${String(bundle.status)}.`,
      );
    }
    if (bundle.body.trim().length === 0) {
      throw new Error("bundle route contract: the served bundle must not be empty.");
    }
    // Expo Go evaluates the bundle as a plain script: ESM `import`/`export`
    // statements must have been bundled away.
    if (/(^|\n)\s*import\s/u.test(bundle.body)) {
      throw new Error(
        'bundle route contract: the served bundle must not contain top-level `import ` statements.',
      );
    }
    if (/(^|\n)\s*export\s/u.test(bundle.body)) {
      throw new Error(
        'bundle route contract: the served bundle must not contain top-level `export ` statements.',
      );
    }
  });
});

CONTRACT_TEST(
  "the source-map route serves a valid v3 source map for the served bundle",
  async () => {
    await withServer(async (handle) => {
      const sourceMapUrl = handle.server.sourceMapUrl;
      if (!sourceMapUrl) {
        throw new Error("source-map route contract: server did not expose a source-map URL.");
      }
      const sourceMap = await handle.fetchUrl(sourceMapUrl);

      if (sourceMap.status !== 200) {
        throw new Error(
          `source-map route contract: expected 200 from ${sourceMapUrl}, received ${String(
            sourceMap.status,
          )}.`,
        );
      }

      // `validateSourceMap` reads from disk, so persist the served payload first.
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "vifx-harness-map-"));
      const sourceMapPath = path.join(tempDir, "index.bundle.map");
      try {
        await writeFile(sourceMapPath, sourceMap.body, "utf8");
        const validation = await validateSourceMap({ sourceMapPath });
        if (!validation.valid) {
          throw new Error(
            `source-map route contract: served map failed @vifx/source-map-tools validation: ${validation.warnings.join(
              "; ",
            )}`,
          );
        }
        if (validation.sourceCount === 0) {
          throw new Error("source-map route contract: served map declares no sources.");
        }
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    });
  },
);

CONTRACT_TEST("the /assets route refuses path traversal outside the project", async () => {
  await withServer(async (handle) => {
    const traversal = await handle.get("/assets/../../package.json");

    // The contract is "do not leak files above the served roots". A 200 carrying
    // the JSON of the harness package manifest would be a traversal escape.
    if (traversal.status === 200 && /"name"\s*:/u.test(traversal.body)) {
      throw new Error(
        "/assets traversal contract: `/assets/../../package.json` leaked file contents with a 200 response.",
      );
    }
  });
});

CONTRACT_TEST(
  "POST /symbolicate maps a bundle stack frame back to original sources",
  async () => {
    await withServer(async (handle) => {
      const sourceMapUrl = handle.server.sourceMapUrl;
      if (!sourceMapUrl) {
        throw new Error("/symbolicate contract: server did not expose a source-map URL.");
      }
      const sourceMap = (await handle.fetchUrl(sourceMapUrl)).json<{
        sources: string[];
      }>();

      // Drive a position guaranteed to be in the map by replaying its own
      // mappings: probe the bundled grid for the first symbolicatable entry.
      const { SourceMap } = await import("node:module");
      const instance = new SourceMap(
        sourceMap as unknown as ConstructorParameters<typeof SourceMap>[0],
      );
      let frame: { column: number; lineNumber: number } | null = null;
      for (let line = 0; line < 400 && !frame; line += 1) {
        for (let column = 0; column < 400; column += 1) {
          const entry = instance.findEntry(line, column);
          if ("originalSource" in entry && entry.originalSource) {
            frame = { column: column + 1, lineNumber: line + 1 };
            break;
          }
        }
      }
      if (!frame) {
        throw new Error("/symbolicate contract: could not find a symbolicatable bundle position.");
      }

      const response = await handle.postJson("/symbolicate", {
        stack: [{ file: "index.bundle", ...frame }],
      });
      if (response.status !== 200) {
        throw new Error(
          `POST /symbolicate contract: expected 200, received ${String(response.status)}.`,
        );
      }

      const symbolication = response.json<{ stack: Array<{ file?: string; source?: string }> }>();
      if (symbolication.stack.length !== 1) {
        throw new Error(
          `POST /symbolicate contract: expected one symbolicated frame, received ${String(
            symbolication.stack.length,
          )}.`,
        );
      }
      const symbolicatedSource = symbolication.stack[0]?.source;
      if (!symbolicatedSource || !sourceMap.sources.includes(symbolicatedSource)) {
        throw new Error(
          `POST /symbolicate contract: frame.source (${String(
            symbolicatedSource,
          )}) must be one of the source map's original sources.`,
        );
      }
    });
  },
);

CONTRACT_TEST(
  "/message WebSocket answers getid + getpeers and routes peer-to-peer frames",
  async () => {
    await withServer(async (handle) => {
      const clientA = await handle.openMessageClient();
      const clientB = await handle.openMessageClient();

      // getid -> the server replies with this client's stable id.
      clientA.sendJson({ id: "id-a", method: "getid", target: "server", version: 2 });
      const idAReply = await clientA.nextJson<{ id: string; result: string }>();
      if (idAReply.id !== "id-a" || typeof idAReply.result !== "string" || !idAReply.result) {
        throw new Error(
          `/message getid contract: expected { id: "id-a", result: <string id> }, received ${JSON.stringify(
            idAReply,
          )}.`,
        );
      }
      const idA = idAReply.result;

      clientB.sendJson({ id: "id-b", method: "getid", target: "server", version: 2 });
      const idBReply = await clientB.nextJson<{ id: string; result: string }>();
      const idB = idBReply.result;
      if (!idB || idB === idA) {
        throw new Error(
          `/message getid contract: each client must receive a distinct id, received ${idA} and ${String(
            idB,
          )}.`,
        );
      }

      // getpeers -> the server replies with the peers map (keyed by peer id).
      clientA.sendJson({ id: "peers-a", method: "getpeers", target: "server", version: 2 });
      const peersReply = await clientA.nextJson<{ id: string; result: Record<string, string> }>();
      if (peersReply.id !== "peers-a") {
        throw new Error(
          `/message getpeers contract: response id must echo the request id, received ${JSON.stringify(
            peersReply.id,
          )}.`,
        );
      }
      if (!peersReply.result || typeof peersReply.result !== "object") {
        throw new Error(
          `/message getpeers contract: expected a peers map object, received ${JSON.stringify(
            peersReply.result,
          )}.`,
        );
      }
      if (!Object.keys(peersReply.result).includes(idB)) {
        throw new Error(
          `/message getpeers contract: peers map must include the other client (${idB}), received keys ${JSON.stringify(
            Object.keys(peersReply.result),
          )}.`,
        );
      }

      // peer-to-peer -> a targeted frame is forwarded to that client only, tagged
      // with the sender's id so it can reply.
      const routedPromise = clientB.nextJson<{
        id: { clientId: string; requestId: number };
        method: string;
        params: { ping: string };
      }>();
      clientA.sendJson({
        id: 7,
        method: "vifx-harness-ping",
        params: { ping: "pong" },
        target: idB,
        version: 2,
      });
      const routed = await routedPromise;
      if (routed.method !== "vifx-harness-ping") {
        throw new Error(
          `/message p2p contract: forwarded frame must preserve the method, received ${JSON.stringify(
            routed.method,
          )}.`,
        );
      }
      if (routed.id?.clientId !== idA || routed.id?.requestId !== 7) {
        throw new Error(
          `/message p2p contract: forwarded frame must carry { clientId: ${idA}, requestId: 7 }, received ${JSON.stringify(
            routed.id,
          )}.`,
        );
      }
      if (routed.params?.ping !== "pong") {
        throw new Error(
          `/message p2p contract: forwarded frame must preserve params, received ${JSON.stringify(
            routed.params,
          )}.`,
        );
      }
    });
  },
);

CONTRACT_TEST(
  "an /events reload command broadcasts to every connected /message client",
  async () => {
    await withServer(async (handle) => {
      const clientA = await handle.openMessageClient();
      const clientB = await handle.openMessageClient();
      const events = await handle.openEventsClient();

      const reloadA = clientA.nextJson<{ method: string; params?: { reason?: string } }>();
      const reloadB = clientB.nextJson<{ method: string; params?: { reason?: string } }>();

      events.sendJson({
        command: "reload",
        params: { reason: "harness" },
        type: "command",
        version: 2,
      });

      for (const [label, received] of [
        ["client A", await reloadA],
        ["client B", await reloadB],
      ] as const) {
        if (received.method !== "reload") {
          throw new Error(
            `/events reload contract: ${label} must receive a {"method":"reload"} broadcast, received ${JSON.stringify(
              received,
            )}.`,
          );
        }
        if (received.params?.reason !== "harness") {
          throw new Error(
            `/events reload contract: ${label} must receive the forwarded params, received ${JSON.stringify(
              received.params,
            )}.`,
          );
        }
      }
    });
  },
);

CONTRACT_TEST("an unknown route responds 404", async () => {
  await withServer(async (handle) => {
    const response = await handle.get("/this-route-does-not-exist");
    if (response.status !== 404) {
      throw new Error(
        `unknown-route contract: expected 404, received ${String(response.status)}.`,
      );
    }
  });
});

CONTRACT_TEST(
  "close() stops accepting connections, is idempotent, and frees the port for rebind",
  async () => {
    const project = await createExpoGoTestProject();
    const handle = await startTestServer(project);
    let secondHandle: TestServerHandle | null = null;
    try {
      const boundPort = handle.server.port;

      // Sanity: it is serving before close.
      const before = await handle.get("/status");
      if (before.status !== 200) {
        throw new Error(
          `close() contract: server must be serving before close, received ${String(before.status)}.`,
        );
      }

      await handle.cleanup();

      // Stops accepting: a request after close must fail to connect.
      let refused = false;
      try {
        await fetch(`${handle.server.url}/status`);
      } catch {
        refused = true;
      }
      if (!refused) {
        throw new Error("close() contract: server must stop accepting connections after close.");
      }

      // Idempotent: a second teardown must not throw.
      await handle.cleanup();

      // Port rebind: the freed port can be re-bound by a fresh server.
      secondHandle = await startTestServer(project, { port: boundPort });
      if (secondHandle.server.port !== boundPort) {
        throw new Error(
          `close() contract: freed port ${String(boundPort)} must be re-bindable, rebind landed on ${String(
            secondHandle.server.port,
          )}.`,
        );
      }
      const rebound = await secondHandle.get("/status");
      if (rebound.status !== 200) {
        throw new Error(
          `close() contract: rebound server must serve, received ${String(rebound.status)}.`,
        );
      }
    } finally {
      if (secondHandle) {
        await secondHandle.cleanup();
      }
      await handle.cleanup();
      await rm(project.projectRoot, { force: true, recursive: true });
    }
  },
);
