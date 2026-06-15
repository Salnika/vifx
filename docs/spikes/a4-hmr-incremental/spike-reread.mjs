// Does a warm RolldownBuild.generate() re-READ source files from disk on each
// call? Tiny fixture, 5 sequential generates, edit between each, print whether
// the edit is reflected. Reconciles the contradictory earlier results.

import { rolldown } from "./resolve-rolldown.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "vifx-a4-reread-"));
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/m.js`, `export const v = "V0";\n`);
writeFileSync(`${DIR}/entry.js`, `import { v } from "./m.js";\nexport const e = () => v;\n`);

const bundle = await rolldown({ input: `${DIR}/entry.js` });
for (let i = 0; i < 5; i++) {
  writeFileSync(`${DIR}/m.js`, `export const v = "V${i}";\n`);
  const out = await bundle.generate({ format: "cjs" });
  const code = out.output.find((o) => o.type === "chunk")?.code ?? "";
  const seen = ["V0", "V1", "V2", "V3", "V4"].filter((v) => code.includes(`"${v}"`));
  console.log(`after writing V${i} then generate(): bundle shows ${JSON.stringify(seen)}`);
}
await bundle.close();
rmSync(DIR, { recursive: true, force: true });
