import path from "node:path";
import type { CompatAdapter } from "../../types.ts";
import {
  collectAssetScaleGroup,
  detectPackageManager,
  findWorkspaceRoot,
  inspectProject,
  resolvePlatformFile,
} from "../../primitives.ts";

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

// First-pass Metro adapter: uses fixture-backed filesystem expectations that mirror
// captured Metro behavior for the current compatibility suite.
export const metroAdapter: CompatAdapter = {
  id: "metro",
  label: "metro",
  async runCase(compatCase, context) {
    switch (compatCase.operation.kind) {
      case "project-info": {
        const inspection = await inspectProject(context.fixturePath);
        return {
          expoVersion: inspection.expoVersion,
          packageManager: inspection.packageManager,
          projectType: inspection.projectType,
          reactNativeVersion: inspection.reactNativeVersion,
        };
      }
      case "resolve-file": {
        return resolvePlatformFile(context.fixturePath, compatCase.operation);
      }
      case "asset-scales": {
        return collectAssetScaleGroup(context.fixturePath, compatCase.operation.assetPath);
      }
      case "workspace-root": {
        const workingDirectory = path.join(context.fixturePath, compatCase.operation.cwd);
        const workspaceRoot = await findWorkspaceRoot(workingDirectory);
        return {
          packageManager: await detectPackageManager(workingDirectory),
          relativeRoot: toPosixPath(path.relative(context.fixturePath, workspaceRoot) || "."),
        };
      }
      default: {
        return {
          unsupportedOperation: compatCase.operation,
        };
      }
    }
  },
};
