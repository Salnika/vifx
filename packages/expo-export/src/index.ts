import { createHash, createSign, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { collectAssetGroup, isSupportedAssetFile } from "@vifx/asset-registry";
import { VifxError } from "@vifx/errors";
import { validateSourceMap } from "@vifx/source-map-tools";
import type {
  VifxBundleArtifacts,
  VifxBundlePlatform,
  VifxExpoExportInspectionResult,
  VifxExpoExportGenerationResult,
  VifxExpoExportGeneratedFile,
  VifxExpoNoMetroContractReport,
  VifxExpoNoMetroWorkflowReport,
  VifxExpoUpdatesAsset,
  VifxExpoUpdatesManifest,
  VifxJsonObject,
  VifxJsonValue,
} from "@vifx/types";

export interface InspectExpoExportOptions {
  exportRoot?: string;
  projectRoot: string;
}

export interface EvaluateExpoNoMetroContractOptions {
  exportRoot?: string;
  projectRoot: string;
  supportedExpoSdk?: string;
}

export interface WriteExpoExportOptions {
  bundles: VifxBundleArtifacts[];
  exportRoot?: string;
  manifest?: VifxJsonObject;
  metadata?: VifxJsonObject;
  projectRoot: string;
  updates?: WriteExpoUpdatesOptions;
}

export interface WriteExpoUpdatesOptions {
  baseUrl: string;
  createdAt?: string;
  extra?: VifxJsonObject;
  metadata?: Record<string, string>;
  runtimeVersion: string;
}

export interface StartExpoUpdatesServerOptions {
  exportRoot?: string;
  host?: string;
  port?: number;
  projectRoot: string;
  signing?: ExpoUpdatesSigningOptions;
}

export interface ExpoUpdatesSigningOptions {
  alg?: "rsa-v1_5-sha256";
  keyId?: string;
  privateKey: string | Buffer;
}

export interface VifxExpoUpdatesServer {
  close: () => Promise<void>;
  exportRoot: string;
  host: string;
  port: number;
  projectRoot: string;
  server: Server;
  url: string;
}

const DEFAULT_SUPPORTED_EXPO_SDK = "54";
const VIFX_CONFIG_NAMES = [
  "vifx.config.ts",
  "vifx.config.mts",
  "vifx.config.js",
  "vifx.config.mjs",
] as const;
const VITE_CONFIG_NAMES = [
  "vite.config.vifx.ts",
  "vite.config.vifx.mts",
  "vite.config.vifx.js",
  "vite.config.vifx.mjs",
] as const;

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function relativeFrom(basePath: string, targetPath: string) {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" ? "." : toPosixPath(relativePath);
}

async function walkFiles(rootDirectory: string): Promise<string[]> {
  const filePaths: string[] = [];

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      filePaths.push(entryPath);
    }
  }

  await visit(rootDirectory);
  return filePaths.sort();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readStringDependency(
  packageJson: VifxJsonObject,
  fieldName: "dependencies" | "devDependencies" | "peerDependencies",
  dependencyName: string,
) {
  const field = packageJson[fieldName];
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return null;
  }

  const value = field[dependencyName];
  return typeof value === "string" ? value : null;
}

function readDependency(packageJson: VifxJsonObject, dependencyName: string) {
  return (
    readStringDependency(packageJson, "dependencies", dependencyName) ??
    readStringDependency(packageJson, "devDependencies", dependencyName) ??
    readStringDependency(packageJson, "peerDependencies", dependencyName)
  );
}

async function readPackageJson(projectRoot: string) {
  try {
    return JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ) as VifxJsonObject;
  } catch {
    return {};
  }
}

function isJsonObject(value: VifxJsonValue | undefined): value is VifxJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeJsonObjects(left: VifxJsonObject, right: VifxJsonObject | undefined) {
  return right ? { ...left, ...right } : left;
}

async function readExpoAppManifest(projectRoot: string): Promise<VifxJsonObject> {
  const packageJson = await readPackageJson(projectRoot);
  const packageName = typeof packageJson.name === "string" ? packageJson.name : "vifx-expo-app";
  const appJsonPath = path.join(projectRoot, "app.json");
  const fallback = {
    assetBundlePatterns: ["assets/*"],
    name: packageName,
    slug: packageName,
  };

  try {
    const appJson = JSON.parse(await readFile(appJsonPath, "utf8")) as VifxJsonObject;
    const expo = appJson.expo;
    const manifest = isJsonObject(expo) ? expo : appJson;

    return {
      ...fallback,
      ...manifest,
      assetBundlePatterns: ["assets/*"],
    };
  } catch {
    return fallback;
  }
}

async function hasAnyFile(projectRoot: string, fileNames: readonly string[]) {
  for (const fileName of fileNames) {
    if (await pathExists(path.join(projectRoot, fileName))) {
      return true;
    }
  }

  return false;
}

function createWorkflow(options: VifxExpoNoMetroWorkflowReport): VifxExpoNoMetroWorkflowReport {
  return {
    blockers: [...options.blockers],
    evidence: [...options.evidence],
    id: options.id,
    notes: [...options.notes],
    status: options.status,
    title: options.title,
  };
}

function inferPlatform(filePath: string): "ios" | "android" | "unknown" {
  const normalized = toPosixPath(filePath);
  if (normalized.includes("/ios/")) {
    return "ios";
  }

  if (normalized.includes("/android/")) {
    return "android";
  }

  return "unknown";
}

function inferManifestKind(filePath: string) {
  const fileName = path.basename(filePath).toLowerCase();
  const normalized = toPosixPath(filePath);

  if (normalized.includes("/updates/") && fileName.includes("manifest")) {
    return "updates-manifest";
  }

  if (fileName.includes("metadata")) {
    return "metadata";
  }

  if (fileName.includes("manifest")) {
    return "manifest";
  }

  return "json";
}

export async function inspectExpoExport(
  options: InspectExpoExportOptions,
): Promise<VifxExpoExportInspectionResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const exportRoot = path.resolve(projectRoot, options.exportRoot ?? ".");
  const files = await walkFiles(exportRoot).catch(() => null);

  if (!files) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_NOT_FOUND",
      message: `Could not inspect Expo export root "${exportRoot}".`,
      hint: "Pass an existing exported directory that already contains bundles, assets, and JSON metadata.",
      docsPath: "/reference/packages#vifxexpo-export",
    });
  }

  const bundlePaths = files.filter((filePath) => filePath.endsWith(".bundle"));
  const bundles = await Promise.all(
    bundlePaths.map(async (bundlePath) => {
      const sourceMapPath = `${bundlePath}.map`;
      const bundleStats = await stat(bundlePath);
      const sourceMap = files.includes(sourceMapPath)
        ? await validateSourceMap({ sourceMapPath }).then((validation) => ({
            path: relativeFrom(projectRoot, sourceMapPath),
            sourceCount: validation.sourceCount,
            valid: validation.valid,
            warnings: validation.warnings,
          }))
        : null;

      return {
        bundle: {
          path: relativeFrom(projectRoot, bundlePath),
          sizeBytes: bundleStats.size,
        },
        platform: inferPlatform(bundlePath),
        sourceMap,
      };
    }),
  );

  const manifestPaths = files.filter(
    (filePath) => filePath.endsWith(".json") && !filePath.endsWith(".map"),
  );
  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      contents: JSON.parse(await readFile(manifestPath, "utf8")) as VifxJsonValue,
      kind: inferManifestKind(manifestPath),
      path: relativeFrom(projectRoot, manifestPath),
    })),
  );

  const assetSourcePaths = files.filter(
    (filePath) => isSupportedAssetFile(filePath) && !filePath.endsWith(".json"),
  );
  const assets = await Promise.all(
    assetSourcePaths.map(async (assetPath) => {
      const descriptor = await collectAssetGroup({
        filePath: assetPath,
        projectRoot,
      });
      const assetStats = await stat(assetPath);

      return {
        emittedPath: relativeFrom(projectRoot, assetPath),
        hash: descriptor.hash,
        height: descriptor.height,
        httpServerLocation: descriptor.httpServerLocation,
        name: descriptor.name,
        scales: [...descriptor.scales],
        sizeBytes: assetStats.size,
        sourceFilePath: relativeFrom(projectRoot, assetPath),
        type: descriptor.type,
        width: descriptor.width,
      };
    }),
  );

  const warnings: string[] = [];
  if (bundles.length === 0) {
    warnings.push(
      `No Expo export bundles were found under "${relativeFrom(projectRoot, exportRoot)}".`,
    );
  }

  return {
    assets: assets.sort((left, right) => left.emittedPath.localeCompare(right.emittedPath)),
    bundles: bundles.sort((left, right) => left.bundle.path.localeCompare(right.bundle.path)),
    exportRoot: relativeFrom(projectRoot, exportRoot),
    manifests: manifests.sort((left, right) => left.path.localeCompare(right.path)),
    projectRoot,
    warnings,
  };
}

function ensureBundlePlatforms(bundles: VifxBundleArtifacts[]) {
  const seenPlatforms = new Set<VifxBundlePlatform>();

  for (const bundle of bundles) {
    if (seenPlatforms.has(bundle.platform)) {
      throw new VifxError({
        code: "VIFX_EXPO_EXPORT_DUPLICATE_PLATFORM",
        message: `Expo export received more than one bundle for platform "${bundle.platform}".`,
        hint: "Build one configured target per platform before generating an Expo export.",
        docsPath: "/reference/cli#vifx-expo-export",
      });
    }

    seenPlatforms.add(bundle.platform);
  }
}

function resolveProjectFile(projectRoot: string, relativePath: string) {
  return path.resolve(projectRoot, relativePath);
}

function toBase64Url(buffer: Buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hashFile(filePath: string) {
  return toBase64Url(
    createHash("sha256")
      .update(await readFile(filePath))
      .digest(),
  );
}

function joinUrl(baseUrl: string, relativePath: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(relativePath, normalizedBaseUrl).toString();
}

function contentTypeForFile(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".bundle":
    case ".js":
      return "application/javascript";
    case ".json":
    case ".map":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isExpoUpdatesEndpoint(pathname: string) {
  return pathname === "/" || pathname === "/manifest" || pathname === "/update";
}

function readSingleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function selectManifestResponseFormat(acceptHeader: string | undefined) {
  if (!acceptHeader) {
    return "json";
  }

  const acceptedTypes = acceptHeader.split(",").map((value) => value.trim().toLowerCase());
  const acceptsAny = acceptedTypes.some((value) => value === "*/*" || value.startsWith("*/*;"));
  const acceptsJson = acceptedTypes.some(
    (value) => value.startsWith("application/expo+json") || value.startsWith("application/json"),
  );
  const acceptsMultipart = acceptedTypes.some((value) => value.startsWith("multipart/mixed"));

  if (acceptsJson || acceptsAny) {
    return "json";
  }

  if (acceptsMultipart) {
    return "multipart";
  }

  return null;
}

function parseExpoExpectSignature(headerValue: string | undefined) {
  if (!headerValue) {
    return null;
  }

  return {
    alg: headerValue.match(/\balg="(?<alg>[^"]+)"/u)?.groups?.alg,
    keyId: headerValue.match(/\bkeyid="(?<keyid>[^"]+)"/u)?.groups?.keyid,
  };
}

function createExpoSignatureHeader(manifestBody: string, signing: ExpoUpdatesSigningOptions) {
  const alg = signing.alg ?? "rsa-v1_5-sha256";
  const signature = createSign("RSA-SHA256").update(manifestBody).end().sign(signing.privateKey);
  const fields = [`sig="${toBase64Url(signature)}"`];

  if (signing.keyId) {
    fields.push(`keyid="${signing.keyId}"`);
  }

  fields.push(`alg="${alg}"`);
  return fields.join(", ");
}

function createMultipartManifestBody(options: {
  boundary: string;
  manifestBody: string;
  signatureHeader?: string;
}) {
  return [
    `--${options.boundary}`,
    'content-disposition: form-data; name="manifest"',
    "content-type: application/expo+json",
    ...(options.signatureHeader ? [`expo-signature: ${options.signatureHeader}`] : []),
    "",
    options.manifestBody.trimEnd(),
    `--${options.boundary}--`,
    "",
  ].join("\r\n");
}

async function ensureExportRootDirectory(exportRoot: string) {
  try {
    const exportStats = await stat(exportRoot);
    if (!exportStats.isDirectory()) {
      throw new Error(`Expected a directory at "${exportRoot}".`);
    }
  } catch (error) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_NOT_FOUND",
      message: `Could not serve Expo export root "${exportRoot}".`,
      hint: "Run vifx expo export first or pass --export-root to an existing generated export directory.",
      docsPath: "/reference/cli#vifx-expo-serve",
      cause: error,
    });
  }
}

async function resolveExportFilePath(exportRoot: string, requestPathname: string) {
  const normalizedPathname = requestPathname === "/" ? "/manifest.json" : requestPathname;
  const candidatePath = path.resolve(exportRoot, `.${normalizedPathname}`);
  const normalizedExportRoot = path.resolve(exportRoot);

  if (
    candidatePath !== normalizedExportRoot &&
    !candidatePath.startsWith(`${normalizedExportRoot}${path.sep}`)
  ) {
    return null;
  }

  if (!(await pathExists(candidatePath))) {
    return null;
  }

  const candidateStats = await stat(candidatePath);
  return candidateStats.isFile() ? candidatePath : null;
}

async function readUpdatesManifestForRequest(options: {
  exportRoot: string;
  platform: string;
  runtimeVersion: string;
}) {
  if (options.platform !== "ios" && options.platform !== "android") {
    return null;
  }

  const manifestPath = path.join(options.exportRoot, "updates", options.platform, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    return null;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as VifxJsonValue;
  if (!isJsonObject(manifest) || manifest.runtimeVersion !== options.runtimeVersion) {
    return null;
  }

  return {
    manifest,
    path: manifestPath,
  };
}

function immutableExportPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname.endsWith(".bundle");
}

export async function startExpoUpdatesServer(
  options: StartExpoUpdatesServerOptions,
): Promise<VifxExpoUpdatesServer> {
  const projectRoot = path.resolve(options.projectRoot);
  const exportRoot = path.resolve(projectRoot, options.exportRoot ?? "dist/expo");
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8081;
  const signing = options.signing;

  await ensureExportRootDirectory(exportRoot);

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          Allow: "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Method Not Allowed");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://vifx.local");
      if (isExpoUpdatesEndpoint(requestUrl.pathname)) {
        const protocolVersion = readSingleHeader(request.headers["expo-protocol-version"]);
        const platform = readSingleHeader(request.headers["expo-platform"]);
        const runtimeVersion = readSingleHeader(request.headers["expo-runtime-version"]);
        const expectSignature = parseExpoExpectSignature(
          readSingleHeader(request.headers["expo-expect-signature"]),
        );
        const responseFormat = selectManifestResponseFormat(
          readSingleHeader(request.headers.accept),
        );

        if (protocolVersion !== "1" || !platform || !runtimeVersion) {
          response.writeHead(400, {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(
            "Expo Updates requests require expo-protocol-version: 1, expo-platform, and expo-runtime-version headers.",
          );
          return;
        }

        if (!responseFormat) {
          response.writeHead(406, {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(
            "Only application/expo+json, application/json, and multipart/mixed manifest responses are supported.",
          );
          return;
        }

        if (expectSignature) {
          if (!signing) {
            response.writeHead(406, {
              "Cache-Control": "no-store",
              "Content-Type": "text/plain; charset=utf-8",
              "expo-protocol-version": "1",
              "expo-sfv-version": "0",
            });
            response.end(
              "Expo Updates code signing was requested, but this server was not started with signing options.",
            );
            return;
          }

          const signingAlg = signing.alg ?? "rsa-v1_5-sha256";
          if (expectSignature.alg && expectSignature.alg !== signingAlg) {
            response.writeHead(406, {
              "Cache-Control": "no-store",
              "Content-Type": "text/plain; charset=utf-8",
              "expo-protocol-version": "1",
              "expo-sfv-version": "0",
            });
            response.end(`Unsupported Expo Updates signing algorithm "${expectSignature.alg}".`);
            return;
          }

          if (expectSignature.keyId && signing.keyId && expectSignature.keyId !== signing.keyId) {
            response.writeHead(406, {
              "Cache-Control": "no-store",
              "Content-Type": "text/plain; charset=utf-8",
              "expo-protocol-version": "1",
              "expo-sfv-version": "0",
            });
            response.end(`Unsupported Expo Updates signing key "${expectSignature.keyId}".`);
            return;
          }
        }

        const manifest = await readUpdatesManifestForRequest({
          exportRoot,
          platform,
          runtimeVersion,
        });
        if (!manifest) {
          response.writeHead(404, {
            "Cache-Control": "private, max-age=0",
            "Content-Type": "text/plain; charset=utf-8",
            "expo-protocol-version": "1",
            "expo-sfv-version": "0",
          });
          response.end("No compatible Expo update was found.");
          return;
        }

        const manifestBody = `${JSON.stringify(manifest.manifest, null, 2)}\n`;
        const responseHeaders: Record<string, string> = {
          "Cache-Control": "private, max-age=0",
          "expo-manifest-filters": `platform="${platform}"`,
          "expo-protocol-version": "1",
          "expo-server-defined-headers": 'generatedBy="vifx"',
          "expo-sfv-version": "0",
        };
        const signatureHeader =
          expectSignature && signing ? createExpoSignatureHeader(manifestBody, signing) : undefined;

        if (responseFormat === "json") {
          responseHeaders["Content-Type"] = "application/expo+json";
          if (signatureHeader) {
            responseHeaders["expo-signature"] = signatureHeader;
          }
        } else {
          const boundary = "vifx-expo-updates";
          responseHeaders["Content-Type"] = `multipart/mixed; boundary=${boundary}`;
          const multipartBody = createMultipartManifestBody({
            boundary,
            manifestBody,
            ...(signatureHeader ? { signatureHeader } : {}),
          });

          response.writeHead(200, responseHeaders);

          if (request.method === "HEAD") {
            response.end();
            return;
          }

          response.end(multipartBody);
          return;
        }

        response.writeHead(200, responseHeaders);

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        response.end(manifestBody);
        return;
      }

      const filePath = await resolveExportFilePath(exportRoot, requestUrl.pathname);
      if (!filePath) {
        response.writeHead(404, {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Not Found");
        return;
      }

      const fileBuffer = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": immutableExportPath(requestUrl.pathname)
          ? "public, max-age=31536000, immutable"
          : "no-store",
        "Content-Type": contentTypeForFile(filePath),
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      response.end(fileBuffer);
    } catch (error) {
      response.writeHead(500, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error instanceof Error ? error.message : "Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    exportRoot: relativeFrom(projectRoot, exportRoot),
    host,
    port: actualPort,
    projectRoot,
    server,
    url: `http://${displayHost}:${actualPort}`,
  };
}

function fileExtensionFor(filePath: string) {
  const extension = path.extname(filePath);
  return extension === "" ? undefined : extension;
}

async function createUpdatesAsset(options: {
  baseUrl: string;
  filePath: string;
  key: string;
  relativeUrlPath: string;
  withFileExtension: boolean;
}): Promise<VifxExpoUpdatesAsset> {
  const asset: VifxExpoUpdatesAsset = {
    contentType: contentTypeForFile(options.filePath),
    hash: await hashFile(options.filePath),
    key: options.key,
    url: joinUrl(options.baseUrl, options.relativeUrlPath),
  };

  if (options.withFileExtension) {
    const fileExtension = fileExtensionFor(options.filePath);
    if (fileExtension) {
      asset.fileExtension = fileExtension;
    }
  }

  return asset;
}

function normalizeUpdatesMetadata(
  platform: VifxBundlePlatform,
  metadata: Record<string, string> | undefined,
) {
  return {
    generatedBy: "vifx",
    platform,
    ...metadata,
  };
}

async function writeExpoUpdatesManifest(options: {
  assets: Map<string, string>;
  bundlePath: string;
  bundleRelativePath: string;
  exportRoot: string;
  manifest: VifxJsonObject;
  platform: VifxBundlePlatform;
  projectRoot: string;
  updates: WriteExpoUpdatesOptions;
}): Promise<{
  generatedFile: VifxExpoExportGeneratedFile;
  manifest: VifxExpoUpdatesManifest;
}> {
  const updatesDirectory = path.join(options.exportRoot, "updates", options.platform);
  await mkdir(updatesDirectory, { recursive: true });

  const createdAt = options.updates.createdAt ?? new Date().toISOString();
  const baseUrl = options.updates.baseUrl;
  const assets = await Promise.all(
    [...options.assets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetRelativePath, assetPath]) =>
        createUpdatesAsset({
          baseUrl,
          filePath: assetPath,
          key: assetRelativePath,
          relativeUrlPath: assetRelativePath,
          withFileExtension: true,
        }),
      ),
  );
  const updatesManifest: VifxExpoUpdatesManifest = {
    assets,
    createdAt,
    extra: {
      expoClient: options.manifest,
      ...options.updates.extra,
    },
    id: randomUUID(),
    launchAsset: await createUpdatesAsset({
      baseUrl,
      filePath: options.bundlePath,
      key: `${options.platform}-bundle`,
      relativeUrlPath: options.bundleRelativePath,
      withFileExtension: false,
    }),
    metadata: normalizeUpdatesMetadata(options.platform, options.updates.metadata),
    runtimeVersion: options.updates.runtimeVersion,
  };
  const manifestPath = path.join(updatesDirectory, "manifest.json");

  await writeFile(manifestPath, `${JSON.stringify(updatesManifest, null, 2)}\n`, "utf8");

  return {
    generatedFile: {
      kind: "updates-manifest",
      path: relativeFrom(options.projectRoot, manifestPath),
      platform: options.platform,
    },
    manifest: updatesManifest,
  };
}

export async function writeExpoExport(
  options: WriteExpoExportOptions,
): Promise<VifxExpoExportGenerationResult> {
  if (options.bundles.length === 0) {
    throw new VifxError({
      code: "VIFX_EXPO_EXPORT_TARGETS_MISSING",
      message: "Expo export generation requires at least one Vifx bundle artifact.",
      hint: "Run a Vifx Expo build target before generating an Expo export.",
      docsPath: "/reference/cli#vifx-expo-export",
    });
  }

  ensureBundlePlatforms(options.bundles);

  const projectRoot = path.resolve(options.projectRoot);
  const exportRoot = path.resolve(projectRoot, options.exportRoot ?? "dist/expo");
  const generatedFiles: VifxExpoExportGeneratedFile[] = [];
  const platforms = options.bundles.map((bundle) => bundle.platform).sort();
  const bundleMetadata: Record<string, string> = {};
  const sourceMapMetadata: Record<string, string> = {};
  const assetMetadata = new Map<string, VifxJsonObject>();
  const assetOutputPaths = new Map<string, string>();
  const bundleOutputPaths = new Map<VifxBundlePlatform, string>();
  const updatesManifests: VifxExpoUpdatesManifest[] = [];

  await mkdir(exportRoot, { recursive: true });

  for (const bundle of [...options.bundles].sort((left, right) =>
    left.platform.localeCompare(right.platform),
  )) {
    const platformDirectory = path.join(exportRoot, bundle.platform);
    await mkdir(platformDirectory, { recursive: true });

    const bundleOutputPath = path.join(platformDirectory, "index.bundle");
    await copyFile(resolveProjectFile(projectRoot, bundle.bundle.path), bundleOutputPath);
    const bundleRelativePath = relativeFrom(exportRoot, bundleOutputPath);
    bundleMetadata[bundle.platform] = bundleRelativePath;
    bundleOutputPaths.set(bundle.platform, bundleOutputPath);
    generatedFiles.push({
      kind: "bundle",
      path: relativeFrom(projectRoot, bundleOutputPath),
      platform: bundle.platform,
    });

    if (bundle.sourceMap) {
      const sourceMapOutputPath = `${bundleOutputPath}.map`;
      await copyFile(resolveProjectFile(projectRoot, bundle.sourceMap.path), sourceMapOutputPath);
      sourceMapMetadata[bundle.platform] = relativeFrom(exportRoot, sourceMapOutputPath);
      generatedFiles.push({
        kind: "source-map",
        path: relativeFrom(projectRoot, sourceMapOutputPath),
        platform: bundle.platform,
      });
    }

    for (const asset of bundle.assets) {
      const assetOutputPath = path.join(exportRoot, "assets", path.basename(asset.emittedPath));
      const assetRelativePath = relativeFrom(exportRoot, assetOutputPath);

      if (assetMetadata.has(assetRelativePath)) {
        continue;
      }

      await mkdir(path.dirname(assetOutputPath), { recursive: true });
      await copyFile(resolveProjectFile(projectRoot, asset.emittedPath), assetOutputPath);
      assetOutputPaths.set(assetRelativePath, assetOutputPath);
      assetMetadata.set(assetRelativePath, {
        hash: asset.hash ?? null,
        height: asset.height ?? null,
        httpServerLocation: asset.httpServerLocation,
        name: asset.name,
        path: assetRelativePath,
        scales: asset.scales,
        type: asset.type,
        width: asset.width ?? null,
      });
      generatedFiles.push({
        kind: "asset",
        path: relativeFrom(projectRoot, assetOutputPath),
        platform: bundle.platform,
      });
    }
  }

  const manifest = mergeJsonObjects(await readExpoAppManifest(projectRoot), options.manifest);
  const metadata = mergeJsonObjects(
    {
      assets: [...assetMetadata.values()],
      bundles: bundleMetadata,
      generatedBy: "vifx",
      platforms,
      sourceMaps: sourceMapMetadata,
      version: 1,
    },
    options.metadata,
  );
  const manifestPath = path.join(exportRoot, "manifest.json");
  const metadataPath = path.join(exportRoot, "metadata.json");

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  if (options.updates) {
    for (const platform of platforms) {
      const bundleOutputPath = bundleOutputPaths.get(platform);
      const bundleRelativePath = bundleMetadata[platform];
      if (!bundleOutputPath || !bundleRelativePath) {
        continue;
      }

      const updatesResult = await writeExpoUpdatesManifest({
        assets: assetOutputPaths,
        bundlePath: bundleOutputPath,
        bundleRelativePath,
        exportRoot,
        manifest,
        platform,
        projectRoot,
        updates: options.updates,
      });
      updatesManifests.push(updatesResult.manifest);
      generatedFiles.push(updatesResult.generatedFile);
    }
  }

  generatedFiles.push(
    {
      kind: "manifest",
      path: relativeFrom(projectRoot, manifestPath),
    },
    {
      kind: "metadata",
      path: relativeFrom(projectRoot, metadataPath),
    },
  );

  const inspection = await inspectExpoExport({
    exportRoot: relativeFrom(projectRoot, exportRoot),
    projectRoot,
  });

  return {
    ...inspection,
    generatedFiles: generatedFiles.sort((left, right) => left.path.localeCompare(right.path)),
    updatesManifests: updatesManifests.sort((left, right) =>
      left.runtimeVersion.localeCompare(right.runtimeVersion),
    ),
  };
}

function hasVifxGeneratedMetadata(exportInspection: VifxExpoExportInspectionResult) {
  return exportInspection.manifests.some(
    (manifest) =>
      manifest.kind === "metadata" &&
      isJsonObject(manifest.contents) &&
      manifest.contents.generatedBy === "vifx",
  );
}

function hasVifxGeneratedUpdatesManifest(exportInspection: VifxExpoExportInspectionResult) {
  return exportInspection.manifests.some(
    (manifest) =>
      manifest.kind === "updates-manifest" &&
      isJsonObject(manifest.contents) &&
      typeof manifest.contents.runtimeVersion === "string" &&
      isJsonObject(manifest.contents.launchAsset),
  );
}

export async function evaluateExpoNoMetroContract(
  options: EvaluateExpoNoMetroContractOptions,
): Promise<VifxExpoNoMetroContractReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const supportedExpoSdk = options.supportedExpoSdk ?? DEFAULT_SUPPORTED_EXPO_SDK;
  const packageJson = await readPackageJson(projectRoot);
  const expoVersion = readDependency(packageJson, "expo");
  const reactNativeVersion = readDependency(packageJson, "react-native");
  const expoRouterVersion = readDependency(packageJson, "expo-router");
  const appDirectory = await pathExists(path.join(projectRoot, "app"));
  const hasVifxConfig = await hasAnyFile(projectRoot, VIFX_CONFIG_NAMES);
  const hasViteConfig = await hasAnyFile(projectRoot, VITE_CONFIG_NAMES);
  const exportInspection = options.exportRoot
    ? await inspectExpoExport({
        exportRoot: options.exportRoot,
        projectRoot,
      }).catch(() => null)
    : null;
  const vifxGeneratedExport = exportInspection ? hasVifxGeneratedMetadata(exportInspection) : false;
  const vifxGeneratedUpdates = exportInspection
    ? hasVifxGeneratedUpdatesManifest(exportInspection)
    : false;
  const warnings: string[] = [];

  if (!expoVersion) {
    warnings.push("Expo dependency was not found in package.json.");
  } else if (!expoVersion.includes(supportedExpoSdk)) {
    warnings.push(
      `Expo dependency "${expoVersion}" is outside the fixture-backed SDK ${supportedExpoSdk} range.`,
    );
  }

  if (!reactNativeVersion) {
    warnings.push("React Native dependency was not found in package.json.");
  }

  const workflows: VifxExpoNoMetroWorkflowReport[] = [
    createWorkflow({
      blockers:
        hasVifxConfig && hasViteConfig
          ? [
              "The Vifx Expo dev server is bounded to browser previews with Vite HMR; native dev-client protocol and React Native Fast Refresh parity remain unimplemented.",
            ]
          : ["Add Vifx and Vite experiment configs before claiming Expo dev-server coverage."],
      evidence: [
        ...(hasVifxConfig ? ["Vifx config detected."] : []),
        ...(hasViteConfig ? ["Vifx-owned Vite config detected."] : []),
        ...(hasVifxConfig && hasViteConfig
          ? ["`vifx expo dev` can start a bounded Vite browser dev server."]
          : []),
      ],
      id: "dev-server",
      notes: ["The bounded dev server does not replace `expo start`, Expo Go, or native devices."],
      status: hasVifxConfig && hasViteConfig ? "partial" : "blocked",
      title: "Expo dev server without Metro",
    }),
    createWorkflow({
      blockers:
        hasVifxConfig && hasViteConfig
          ? ["Native Expo build parity is not proven; only controlled bundle builds are covered."]
          : ["Add Vifx and Vite experiment configs before claiming Expo build coverage."],
      evidence: [
        ...(hasVifxConfig ? ["Vifx config detected."] : []),
        ...(hasViteConfig ? ["Vifx-owned Vite config detected."] : []),
      ],
      id: "build",
      notes: [
        "`vifx build` can cover configured bundle targets but does not replace EAS or Expo native builds.",
      ],
      status: hasVifxConfig && hasViteConfig ? "partial" : "blocked",
      title: "Expo build without Metro",
    }),
    createWorkflow({
      blockers: exportInspection
        ? vifxGeneratedExport
          ? [
              "Vifx-generated Expo export output is bounded to bundles, source maps, assets, manifest, metadata, and optional Updates manifests; full Updates serving, response signing, native validation, directives, and EAS parity remain unimplemented.",
            ]
          : ["Vifx can inspect existing Expo exports but has not generated this export output."]
        : ["No existing Expo export root was provided for inspection."],
      evidence: exportInspection
        ? [
            `Inspected ${exportInspection.bundles.length} bundle(s), ${exportInspection.assets.length} asset(s), and ${exportInspection.manifests.length} manifest(s).`,
            ...(vifxGeneratedExport ? ["Vifx-generated export metadata detected."] : []),
          ]
        : [],
      id: "export",
      notes: [
        "Full Updates serving, response signing, native validation, directives, and EAS metadata parity remain separate Program C work.",
      ],
      status: exportInspection ? (vifxGeneratedExport ? "partial" : "inspect-only") : "blocked",
      title: "Expo export without Metro",
    }),
    createWorkflow({
      blockers:
        expoRouterVersion || appDirectory
          ? ["Expo Router is only covered by bounded browser-preview experiments."]
          : ["No Expo Router dependency or app directory was detected."],
      evidence: [
        ...(expoRouterVersion ? [`expo-router dependency detected: ${expoRouterVersion}.`] : []),
        ...(appDirectory ? ["Expo app/ directory detected."] : []),
      ],
      id: "router",
      notes: ["Native routing, deep links, invalidation, and Expo Go parity remain unproven."],
      status: expoRouterVersion || appDirectory ? "partial" : "blocked",
      title: "Expo Router without Metro",
    }),
    createWorkflow({
      blockers: [
        "Expo iOS native integration with Vifx bundles has not executed build, install, or launch gates.",
      ],
      evidence: [],
      id: "native-ios",
      notes: [
        "Program B native diagnostics exist, but Expo native integration remains separate work.",
      ],
      status: "blocked",
      title: "Expo iOS runtime without Metro",
    }),
    createWorkflow({
      blockers: [
        "Expo Android native integration with Vifx bundles has not executed build, install, or launch gates.",
      ],
      evidence: [],
      id: "native-android",
      notes: [
        "Program B native diagnostics exist, but Expo native integration remains separate work.",
      ],
      status: "blocked",
      title: "Expo Android runtime without Metro",
    }),
    createWorkflow({
      blockers: vifxGeneratedUpdates
        ? [
            "Expo Updates v1 manifests can be served locally as JSON or multipart manifest responses and signed when configured for bounded export artifacts, but no directive, EAS parity, or native client execution gate exists yet.",
          ]
        : ["Expo Updates manifests and update artifacts are not generated by Vifx yet."],
      evidence: vifxGeneratedUpdates ? ["Vifx-generated Expo Updates v1 manifest detected."] : [],
      id: "updates",
      notes: [
        "`vifx expo serve` handles bounded JSON or multipart manifest responses, optional response signing, and asset responses; directives and native application remain separate work.",
      ],
      status: vifxGeneratedUpdates ? "partial" : "blocked",
      title: "Expo Updates without Metro",
    }),
  ];
  const decision = workflows.every((workflow) => workflow.status === "supported")
    ? "supported"
    : workflows.some(
          (workflow) => workflow.status === "partial" || workflow.status === "inspect-only",
        )
      ? "partial"
      : "blocked";

  return {
    appDirectory,
    decision,
    expoRouter: Boolean(expoRouterVersion),
    expoVersion,
    projectRoot,
    reactNativeVersion,
    supportedExpoSdk,
    warnings,
    workflows,
  };
}
