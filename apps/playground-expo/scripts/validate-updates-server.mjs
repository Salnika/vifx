import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.resolve(projectRoot, "../../packages/cli/bin/vifx.mjs");
const debug = process.env.VIFX_DEBUG_UPDATES_VALIDATE === "1";

function log(...args) {
  if (debug) {
    console.error("[updates-validate]", ...args);
  }
}

async function startServeProcess(signingKeyPath) {
  const child = spawn(
    process.execPath,
    [
      cliPath,
      "expo",
      "serve",
      ".",
      "--export-root",
      "dist/expo",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--signing-key",
      signingKeyPath,
      "--signing-key-id",
      "root",
      "--json",
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stderrChunks = [];
  let stdout = "";

  return await new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for vifx expo serve startup.\nstdout:\n${stdout}\nstderr:\n${stderrChunks.join("")}`,
        ),
      );
    }, 5000);

    const cleanup = () => {
      clearTimeout(startupTimer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onStderr = (chunk) => {
      stderrChunks.push(chunk.toString());
    };

    const onExit = (code) => {
      cleanup();
      reject(
        new Error(
          `vifx expo serve exited before validation completed (code ${code ?? "unknown"}): ${stderrChunks.join("")}`,
        ),
      );
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onStdout = (chunk) => {
      stdout += chunk.toString();

      try {
        const parsed = JSON.parse(stdout);
        cleanup();
        log("serve-started", parsed.url);
        resolve({ child, server: parsed, stderrChunks });
      } catch {}
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopServeProcess(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 1000);

    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolve();
    });
  });
}

function readManifestPart(body) {
  const separator = "\r\n\r\n";
  const separatorIndex = body.indexOf(separator);
  assert.notEqual(separatorIndex, -1, "Expected multipart manifest body separator.");

  return body.slice(
    separatorIndex + separator.length,
    body.lastIndexOf("\r\n--vifx-expo-updates--"),
  );
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vifx-expo-serve-"));
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKey = keyPair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const signingKeyPath = path.join(tempRoot, "updates-private-key.pem");

  await writeFile(signingKeyPath, privateKey, "utf8");

  const { child, server } = await startServeProcess(signingKeyPath);

  try {
    assert.equal(typeof server.url, "string", "Expected vifx expo serve to report a URL.");
    log("manifest-json-request");

    const manifestResponse = await fetch(server.url, {
      headers: {
        accept: "application/expo+json, application/json",
        connection: "close",
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });

    assert.equal(manifestResponse.status, 200, "Expected JSON manifest request to succeed.");
    assert.equal(
      manifestResponse.headers.get("content-type"),
      "application/expo+json",
      "Expected JSON manifest response content-type.",
    );

    const manifest = await manifestResponse.json();

    assert.equal(manifest.runtimeVersion, "1.0.0");
    assert.equal(manifest.launchAsset.url, "http://localhost:8081/ios/index.bundle");
    log("manifest-json-ok");

    log("manifest-multipart-request");
    const multipartResponse = await fetch(server.url, {
      headers: {
        accept: "multipart/mixed, application/expo+json",
        connection: "close",
        "expo-expect-signature": 'sig, keyid="root", alg="rsa-v1_5-sha256"',
        "expo-platform": "ios",
        "expo-protocol-version": "1",
        "expo-runtime-version": "1.0.0",
      },
    });

    assert.equal(multipartResponse.status, 200, "Expected multipart manifest request to succeed.");
    assert.equal(
      multipartResponse.headers.get("content-type"),
      "multipart/mixed; boundary=vifx-expo-updates",
      "Expected multipart manifest response content-type.",
    );

    const multipartBody = await multipartResponse.text();
    const signatureHeader =
      multipartBody.match(/expo-signature: (?<signature>[^\r\n]+)/iu)?.groups?.signature ?? "";
    const signature = signatureHeader.match(/\bsig="(?<sig>[^"]+)"/u)?.groups?.sig;

    assert.match(signatureHeader, /keyid="root"/u, "Expected multipart signature key id.");
    assert.match(signatureHeader, /alg="rsa-v1_5-sha256"/u, "Expected multipart signature alg.");
    assert.ok(signature, "Expected multipart signature.");

    const manifestPart = readManifestPart(multipartBody);
    const verifier = createVerify("RSA-SHA256");

    verifier.update(`${manifestPart}\n`);
    verifier.end();

    assert.equal(
      verifier.verify(publicKey, Buffer.from(signature, "base64url")),
      true,
      "Expected multipart signature verification to succeed.",
    );
    log("manifest-multipart-ok");
  } finally {
    log("serve-stop");
    await stopServeProcess(child);
    log("serve-stopped");
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
