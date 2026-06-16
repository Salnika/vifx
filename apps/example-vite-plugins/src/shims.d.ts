// Ambient declarations so TypeScript understands the plugin-provided imports.

// Provided at build time by plugins/virtual-module.ts (no file on disk).
declare module "virtual:vifx-example" {
  export const virtualGreeting: string;
}

// Provided at build time by plugins/yaml.ts (parsed from the .yaml file).
declare module "*.yaml" {
  const data: Record<string, string>;
  export default data;
}

// Provided by vifx's asset pipeline (URL string for the bundled asset).
declare module "*.svg" {
  const url: string;
  export default url;
}
