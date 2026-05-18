import type { ParseFlagsOptions, ParsedFlags } from "../types.ts";

function resolveAlias(argument: string, aliases: Record<string, string>) {
  return aliases[argument] ?? argument;
}

export function parseFlags(argv: string[], options: ParseFlagsOptions = {}): ParsedFlags {
  const booleanFlags = new Set(options.booleanFlags ?? []);
  const stringFlags = new Set(options.stringFlags ?? []);
  const aliases = options.aliases ?? {};
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const errors: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = resolveAlias(argv[index]!, aliases);

    if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }

    if (!argument.startsWith("--")) {
      if (!options.ignoreUnknownFlags) {
        errors.push(`Unknown flag ${argument}.`);
      }
      continue;
    }

    const rawFlag = argument.slice(2);
    const separatorIndex = rawFlag.indexOf("=");
    const flagName = separatorIndex === -1 ? rawFlag : rawFlag.slice(0, separatorIndex);
    const inlineValue = separatorIndex === -1 ? undefined : rawFlag.slice(separatorIndex + 1);

    if (booleanFlags.has(flagName)) {
      flags[flagName] = inlineValue ? inlineValue !== "false" : true;
      continue;
    }

    if (stringFlags.has(flagName)) {
      if (inlineValue !== undefined) {
        flags[flagName] = inlineValue;
        continue;
      }

      const nextArgument = argv[index + 1];
      if (!nextArgument || nextArgument.startsWith("-")) {
        errors.push(`Flag --${flagName} requires a value.`);
        continue;
      }

      flags[flagName] = nextArgument;
      index += 1;
      continue;
    }

    if (!options.ignoreUnknownFlags) {
      errors.push(`Unknown flag --${flagName}.`);
    }
  }

  return {
    positional,
    flags,
    errors,
  };
}
