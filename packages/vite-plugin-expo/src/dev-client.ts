import { randomBytes } from "node:crypto";
import { VifxError, serializeVifxError } from "@vifx/errors";
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
 * - `expo-expect-signature` (and the `expo-expects-signature` spelling) requests a
 *   code-signed manifest, which the Vifx dev server does not support; the response
 *   is a structured `VIFX_EXPO_DEV_CLIENT_SIGNING_UNSUPPORTED` error.
 */

const DEV_CLIENT_LAUNCH_HOST = "expo-development-client";
const EXPO_SIGNATURE_REQUEST_HEADERS = ["expo-expect-signature", "expo-expects-signature"] as const;

export interface ManifestNegotiationRequest {
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

function readSignatureRequestHeader(request: ManifestNegotiationRequest) {
  for (const headerName of EXPO_SIGNATURE_REQUEST_HEADERS) {
    const value = readHeader(request, headerName);
    if (value !== null) {
      return { name: headerName, value };
    }
  }

  return null;
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
  const signatureRequest = readSignatureRequestHeader(options.request);

  if (signatureRequest) {
    const error = new VifxError({
      code: "VIFX_EXPO_DEV_CLIENT_SIGNING_UNSUPPORTED",
      message: `The manifest request sent "${signatureRequest.name}", but manifest code signing is unsupported by the Vifx dev server.`,
      hint: "Remove the code-signing requirement (for example expo-updates codeSigningCertificate) from the development client, or use Expo CLI for signed manifests.",
      docsPath: "/reference/packages#vifxvite-plugin-expo",
    });

    return {
      body: `${JSON.stringify(serializeVifxError(error))}\n`,
      headers: {
        "Cache-Control": "private, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
        "expo-protocol-version": protocolVersion,
        "expo-sfv-version": "0",
      },
      status: 501,
    };
  }

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

/** Reads the first URL scheme declared by the resolved Expo app config, if any. */
export function resolveDevClientScheme(exp: VifxJsonObject) {
  const scheme = exp.scheme;
  if (typeof scheme === "string" && scheme.length > 0) {
    return scheme;
  }

  if (Array.isArray(scheme)) {
    for (const candidate of scheme) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
  }

  return null;
}
