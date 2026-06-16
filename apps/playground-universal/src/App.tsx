// @ts-ignore -- playground import intentionally exercises platform file resolution.
import { message } from "./message";

// The unified define table (resolveDefines) inlines every EXPO_PUBLIC_* var as
// BOTH forms, for native AND web, from a single source of truth. Reading both
// here is the whole point of the universal playground: native (ios) and web
// resolve the same define, with no __VIFX_WEB_RUNTIME__ shim involved.
type PlaygroundImportMeta = ImportMeta & {
  env: {
    EXPO_PUBLIC_VIFX_DEMO?: string;
  };
};

// vifx inlines every `process.env.EXPO_PUBLIC_*` read as a string literal at
// build time; declare the shape locally because this demo's tsconfig does not
// pull in `@types/node`.
declare const process: { env: Record<string, string | undefined> };

const fromImportMeta = (import.meta as PlaygroundImportMeta).env.EXPO_PUBLIC_VIFX_DEMO;
const fromProcessEnv = process.env.EXPO_PUBLIC_VIFX_DEMO;

console.log("universal:message", message);
console.log("universal:import.meta.env.EXPO_PUBLIC_VIFX_DEMO", fromImportMeta);
console.log("universal:process.env.EXPO_PUBLIC_VIFX_DEMO", fromProcessEnv);
console.log("universal:both-match", fromImportMeta === fromProcessEnv);

export default function App() {
  return null;
}
