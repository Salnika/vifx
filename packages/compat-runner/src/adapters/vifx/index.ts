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

export const vifxAdapter: CompatAdapter = {
  id: "vifx",
  label: "vifx",
  async runCase(compatCase, context) {
    switch (compatCase.operation.kind) {
      case "project-info": {
        const inspection = await inspectProject(context.fixturePath);
        return {
          projectType: inspection.projectType,
          packageManager: inspection.packageManager,
          expoVersion: inspection.expoVersion,
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
          relativeRoot: toPosixPath(path.relative(context.fixturePath, workspaceRoot) || "."),
          packageManager: await detectPackageManager(workingDirectory),
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
