import { randomBytes } from "node:crypto";
import type { VifxJsonObject } from "@vifx/types";

/**
 * expo-dev-client manifest negotiation.
 *
 * Mirrors the @expo/cli `ExpoGoManifestHandlerMiddleware` contract:
 * - Plain JSON stays the default response (legacy Expo Go clients and browsers).
 * - `Accept: multipart/mixed` (sent by expo-updates protocol-1 clients embedded in
 *   expo-dev-client builds) selects a multipart/mixed response with a single
 *   `manifest` part whose content type is `application/json`.
 * - `expo-protocol-version` is echoed back as `0` only when the client explicitly
 *   requests protocol 0; otherwise the current Vifx default of `1` is preserved.
 * - `expo-expect-signature` (and the `expo-expects-signature` spelling) advertises
 *   that the client can verify a signed manifest. The Vifx dev server does not sign
 *   manifests, so the manifest is served unsigned (no `expo-signature` header) —
 *   Expo Go and expo-dev-client accept unsigned manifests in development, matching
 *   @expo/cli when no code-signing certificate is configured.
 */

const DEV_CLIENT_LAUNCH_HOST = "expo-development-client";

export interface ManifestNegotiationRequest {
  /**
   * Incoming request headers with lowercase names, as found on
   * `node:http` `IncomingMessage.headers`.
   */
  headers: Record<string, string | string[] | undefined>;
}

export interface NegotiatedManifestResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

function readHeader(request: ManifestNegotiationRequest, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

function parseAcceptedTypes(acceptHeader: string | null) {
  if (!acceptHeader) {
    return [];
  }

  return acceptHeader
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter((type) => type.length > 0);
}

// Expo Updates clients explicitly list "multipart/mixed" in their Accept header,
// while browsers and legacy clients only match it implicitly through a wildcard.
// Like @expo/cli, only an explicit listing selects the multipart response.
function acceptsMultipartMixed(request: ManifestNegotiationRequest) {
  return parseAcceptedTypes(readHeader(request, "accept")).includes("multipart/mixed");
}

function resolveResponseProtocolVersion(request: ManifestNegotiationRequest) {
  return readHeader(request, "expo-protocol-version") === "0" ? "0" : "1";
}

function createMultipartBoundary(content: string) {
  let boundary = "";

  do {
    boundary = `vifx-manifest-${randomBytes(16).toString("hex")}`;
  } while (content.includes(boundary));

  return boundary;
}

function createMultipartManifestBody(stringifiedManifest: string, boundary: string) {
  return [
    `--${boundary}`,
    'Content-Disposition: form-data; name="manifest"',
    "Content-Type: application/json",
    "",
    stringifiedManifest,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function negotiateManifestResponse(options: {
  manifestJson: VifxJsonObject;
  request: ManifestNegotiationRequest;
}): NegotiatedManifestResponse {
  const protocolVersion = resolveResponseProtocolVersion(options.request);

  // A client may advertise `expo-expect-signature` to say it can verify a signed
  // manifest. The Vifx dev server does not sign manifests, so we serve the manifest
  // unsigned (omitting the `expo-signature` header). Expo Go and expo-dev-client
  // accept unsigned manifests in development — matching @expo/cli when no
  // code-signing certificate is configured. Returning an error here previously
  // broke loading on physical devices that send the header but tolerate unsigned
  // dev manifests.
  const stringifiedManifest = JSON.stringify(options.manifestJson);

  if (acceptsMultipartMixed(options.request)) {
    const boundary = createMultipartBoundary(stringifiedManifest);

    return {
      body: createMultipartManifestBody(stringifiedManifest, boundary),
      headers: {
        "Cache-Control": "private, max-age=0",
        "Content-Type": `multipart/mixed; boundary=${boundary}`,
        "expo-protocol-version": protocolVersion,
        "expo-sfv-version": "0",
        "expo-manifest-filters": "",
        "expo-server-defined-headers": "",
      },
      status: 200,
    };
  }

  return {
    body: `${stringifiedManifest}\n`,
    headers: {
      "Cache-Control": "private, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "expo-protocol-version": protocolVersion,
      "expo-sfv-version": "0",
      "expo-manifest-filters": "",
      "expo-server-defined-headers": "",
    },
    status: 200,
  };
}

export function createDevClientLaunchUrl(options: { manifestUrl: string; scheme: string }) {
  return `${options.scheme}://${DEV_CLIENT_LAUNCH_HOST}/?url=${encodeURIComponent(options.manifestUrl)}`;
}

// Mirrors @expo/cli UrlCreator.constructDevClientUrl: http(s) can never open a
// development client, and "_" is invalid inside a URL protocol.
function isUsableDevClientScheme(scheme: string) {
  return (
    scheme.length > 0 && !["http", "https"].includes(scheme.toLowerCase()) && !scheme.includes("_")
  );
}

/** Reads the first usable URL scheme declared by the resolved Expo app config, if any. */
export function resolveDevClientScheme(exp: VifxJsonObject) {
  const scheme = exp.scheme;
  if (typeof scheme === "string" && isUsableDevClientScheme(scheme)) {
    return scheme;
  }

  if (Array.isArray(scheme)) {
    for (const candidate of scheme) {
      if (typeof candidate === "string" && isUsableDevClientScheme(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
