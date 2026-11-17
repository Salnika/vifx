import type { MarkdownRenderer } from "vitepress";

// Shell blocks written with npm (`npm install`, `npx`) are rendered as a code
// group with one tab per package manager. The Markdown keeps plain npm
// commands, which also read well on GitHub. The theme keeps every group on the
// reader's choice and remembers it (theme/package-manager.ts).

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const SHELL_LANGUAGES = new Set(["sh", "bash", "shell", "zsh"]);

// Indentation and environment assignments, the npm tool, then the rest.
const NPM_LINE = /^(\s*(?:[A-Z_][A-Z0-9_]*=\S+\s+)*)(npm|npx)\s+(.*)$/u;

// A block that already uses another package manager is left as written.
const OTHER_MANAGER_LINE = /^\s*(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:pnpm|yarn|bunx?)\s/u;

const DEV_FLAGS = new Set(["--save-dev", "-D"]);

const ADD_DEV_FLAG: Record<Exclude<PackageManager, "npm">, string> = {
  pnpm: "--save-dev",
  yarn: "--dev",
  bun: "--dev",
};

/** Splits off a trailing `# comment`, keeping the spaces before it. */
function splitComment(text: string): [command: string, comment: string] {
  const match = /^(.*?)(\s+#.*)?$/u.exec(text);
  return [match?.[1] ?? text, match?.[2] ?? ""];
}

/** `npx <bin> …` for another package manager. */
function translateExec(rest: string, manager: Exclude<PackageManager, "npm">): string {
  const create = /^create-(\S+)(.*)$/u.exec(rest);
  if (create) {
    return `${manager} create ${create[1]}${create[2]}`;
  }
  // Yarn 1 prints `yarn run v1…`, the command and `Done in …` on stdout around
  // a binary's output, which breaks JSON output. `yarn run --silent` leaves
  // them out; Yarn 2 and later accept it there (not before the binary name)
  // and print nothing extra anyway.
  if (manager === "yarn" && /(?:^|\s)--json(?:\s|$)/u.test(splitComment(rest)[0])) {
    return `yarn run --silent ${rest}`;
  }
  // pnpm and Yarn run a dependency's binary by name; `bun <bin>` does too, and
  // unlike `bunx` it never downloads a package of that name.
  return `${manager} ${rest}`;
}

/** `npm <subcommand> …` for another package manager, or undefined if unmapped. */
function translateNpm(rest: string, manager: Exclude<PackageManager, "npm">): string | undefined {
  const [command, comment] = splitComment(rest);
  const [subcommand = "", ...args] = command.trim().split(/\s+/u);

  if (subcommand === "install" || subcommand === "i" || subcommand === "add") {
    const dev = args.some((arg) => DEV_FLAGS.has(arg));
    const packages = args.filter((arg) => !DEV_FLAGS.has(arg));
    if (packages.length === 0) {
      return `${manager} install${comment}`;
    }
    const flag = dev ? ` ${ADD_DEV_FLAG[manager]}` : "";
    return `${manager} add${flag} ${packages.join(" ")}${comment}`;
  }
  if (subcommand === "uninstall" || subcommand === "remove" || subcommand === "rm") {
    return `${manager} remove ${args.join(" ")}${comment}`;
  }
  if (subcommand === "run" && args.length > 0) {
    const script = args.join(" ");
    return manager === "bun" ? `bun run ${script}${comment}` : `${manager} ${script}${comment}`;
  }
  return undefined;
}

function translateLine(line: string, manager: PackageManager): string | undefined {
  const match = NPM_LINE.exec(line);
  if (!match || manager === "npm") {
    return line;
  }
  const [, prefix = "", tool, rest = ""] = match;
  const translated = tool === "npx" ? translateExec(rest, manager) : translateNpm(rest, manager);
  return translated === undefined ? undefined : `${prefix}${translated}`;
}

/** The block's commands for each package manager, or undefined to keep it as is. */
export function packageManagerVariants(
  content: string,
): Record<PackageManager, string> | undefined {
  const lines = content.split("\n");
  if (!lines.some((line) => NPM_LINE.test(line))) {
    return undefined;
  }
  if (lines.some((line) => OTHER_MANAGER_LINE.test(line))) {
    return undefined;
  }
  const variants: Partial<Record<PackageManager, string>> = {};
  for (const manager of PACKAGE_MANAGERS) {
    const translated: string[] = [];
    for (const line of lines) {
      const result = translateLine(line, manager);
      if (result === undefined) {
        return undefined;
      }
      translated.push(result);
    }
    variants[manager] = translated.join("\n");
  }
  return variants as Record<PackageManager, string>;
}

/**
 * Replaces each eligible shell fence with the tokens of a `::: code-group`
 * holding one fence per package manager, so VitePress renders its usual tabs.
 */
export function packageManagerTabs(md: MarkdownRenderer): void {
  md.core.ruler.push("vifx_package_manager_tabs", (state) => {
    const { tokens } = state;
    let groupDepth = 0;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token) {
        continue;
      }
      if (token.type === "container_code-group_open") {
        groupDepth += 1;
        continue;
      }
      if (token.type === "container_code-group_close") {
        groupDepth -= 1;
        continue;
      }
      if (groupDepth > 0 || token.type !== "fence") {
        continue;
      }
      const info = token.info.trim();
      const language = info.split(/\s+/u)[0] ?? "";
      if (!SHELL_LANGUAGES.has(language) || info.includes("[")) {
        continue;
      }
      const variants = packageManagerVariants(token.content);
      if (!variants) {
        continue;
      }

      const open = new state.Token("container_code-group_open", "div", 1);
      open.block = true;
      open.map = token.map;
      open.markup = ":::";
      const fences = PACKAGE_MANAGERS.map((manager) => {
        const fence = new state.Token("fence", "code", 0);
        fence.block = true;
        fence.map = token.map;
        fence.markup = token.markup;
        fence.info = `${info} [${manager}]`;
        fence.content = variants[manager];
        return fence;
      });
      const close = new state.Token("container_code-group_close", "div", -1);
      close.block = true;
      close.markup = ":::";

      tokens.splice(index, 1, open, ...fences, close);
      index += fences.length + 1;
    }
  });
}
