import {
  compatCases,
  evaluateCompatCase,
  getFixtureManifest,
  resolveFixturePath,
} from "@vifx/compat";
import { metroAdapter } from "./adapters/metro/index.ts";
import { vifxAdapter } from "./adapters/vifx/index.ts";
import { buildCategoryReports } from "./reporters.ts";
import type { CompatAdapter, CompatAdapterId, CompatRunOptions, CompatRunReport } from "./types.ts";

function getAdapter(adapterId: CompatAdapterId): CompatAdapter {
  if (adapterId === "metro") {
    return metroAdapter;
  }

  return vifxAdapter;
}

export async function runCompatSuite(options: CompatRunOptions): Promise<CompatRunReport> {
  const adapter = getAdapter(options.adapter);
  const selectedCases = compatCases.filter((compatCase) => {
    if (options.fixtureIds && !options.fixtureIds.includes(compatCase.fixtureId)) {
      return false;
    }

    if (options.caseIds && !options.caseIds.includes(compatCase.id)) {
      return false;
    }

    return true;
  });

  const cases = [];

  for (const compatCase of selectedCases) {
    const fixtureManifest = getFixtureManifest(compatCase.fixtureId);
    const fixturePath = resolveFixturePath(compatCase.fixtureId);
    const actual = await adapter.runCase(compatCase, {
      fixtureId: compatCase.fixtureId,
      fixtureManifest,
      fixturePath,
    });

    cases.push({
      ...evaluateCompatCase(compatCase, actual),
      fixturePath,
    });
  }

  const passedCases = cases.filter((compatCase) => compatCase.passed).length;
  const failedCases = cases.length - passedCases;

  return {
    adapterId: adapter.id,
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    passedCases,
    failedCases,
    status: failedCases === 0 ? "PASS" : "FAIL",
    categories: buildCategoryReports(cases),
    cases,
  };
}

export {
  collectAssetScaleGroup,
  detectPackageManager,
  findWorkspaceRoot,
  inspectProject,
  resolvePlatformFile,
} from "./primitives.ts";
export { formatCompatReport } from "./reporters.ts";
export * from "./types.ts";
