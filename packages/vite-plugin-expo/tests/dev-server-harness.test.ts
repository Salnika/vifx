// Behavioral contract suite for the Expo Go dev server (`startExpoGoDevServer`).
//
// These tests document the server's *observable* contract endpoint-by-endpoint
// so that the sibling Metro-replacement rewrites can be validated against a
// fixed behavioral baseline. Assertion messages name the endpoint contract so a
// failure points directly at the broken guarantee.
//
// Every test uses an ephemeral port (0) and is gated on `canListenOnLocalhost`
// so the suite self-skips in network-restricted sandboxes.

import { test } from "vite-plus/test";
import { canListenOnLocalhost, createExpoGoTestProject, startTestServer } from "./harness.ts";

const CONTRACT_TEST = (await canListenOnLocalhost()) ? test : test.skip;

CONTRACT_TEST("harness builds a synthetic Expo Go project and serves a manifest", async () => {
  const project = await createExpoGoTestProject();
  const handle = await startTestServer(project);
  try {
    const manifest = await handle.get("/manifest");
    if (manifest.status !== 200) {
      throw new Error(`GET /manifest contract: expected 200, received ${manifest.status}.`);
    }
  } finally {
    await handle.cleanup();
  }
});
