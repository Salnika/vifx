// Plugin 1: virtual module — `virtual:vifx-example` has no file on disk; it is
// synthesized by plugins/virtual-module.ts at build time.
import { virtualGreeting } from "virtual:vifx-example";
// Plugin 3: non-JS asset loader — this .yaml is parsed into a JS object by
// plugins/yaml.ts at build time (the @rollup/plugin-yaml pattern).
import appConfig from "./app-config.yaml";

// Plugin 2: custom transform — plugins/build-stamp.ts replaces this token with a
// unique value during `transform`. The literal token below never reaches the
// bundle; its replacement does.
const buildStamp = "__VIFX_BUILD_STAMP__";

// Logging the plugin outputs keeps them reachable so tree-shaking can't drop
// them — that is what makes them greppable in the release bundle (the whole
// build-side proof). On a device these would render in the UI instead.
console.log("[example] virtual module ->", virtualGreeting);
console.log("[example] build stamp ->", buildStamp);
console.log("[example] yaml releaseChannel ->", appConfig.releaseChannel);
console.log("[example] yaml appName ->", appConfig.appName);

export default function App() {
  return null;
}
