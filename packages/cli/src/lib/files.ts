import { promises as fs } from "node:fs";
import path from "node:path";
import type { PlannedFileChange } from "../types.ts";

export function formatPlannedChanges(changes: PlannedFileChange[]) {
  if (changes.length === 0) {
    return "No file changes.";
  }

  return changes
    .map((change) => [`[${change.kind}] ${change.path}`, "", change.after.trimEnd()].join("\n"))
    .join("\n\n");
}

export async function applyPlannedChanges(projectRoot: string, changes: PlannedFileChange[]) {
  for (const change of changes) {
    const absolutePath = path.join(projectRoot, change.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, change.after, "utf8");
  }
}

export async function readTextFileIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
