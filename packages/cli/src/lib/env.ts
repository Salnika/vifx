import { applyProjectEnv, loadProjectEnv, type LoadedProjectEnv } from "@vifx/config";
import type { VifxBundleMode } from "@vifx/types";

/**
 * Loads the project's dotenv files into `process.env` before bundling, the way
 * Expo CLI does when it starts: `EXPO_PUBLIC_*` values from `.env*` then reach
 * the bundle, and a dynamic `app.config.js` sees them too. Variables already
 * set in the shell are left alone.
 */
export async function loadProjectEnvIntoProcess(
  projectRoot: string,
  mode: VifxBundleMode | undefined,
): Promise<LoadedProjectEnv> {
  const loaded = await loadProjectEnv({ mode: mode ?? "development", projectRoot });
  applyProjectEnv(loaded);
  return loaded;
}
