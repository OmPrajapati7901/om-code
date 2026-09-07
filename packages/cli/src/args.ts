/** Small command-aware flag parser shared by every CLI command. */

export type FlagDefinition = {
  readonly name: string;
  readonly short?: string;
  readonly takesValue: boolean;
};

export type ParsedArgs = {
  readonly flags: Readonly<Record<string, string | true>>;
  readonly positionals: readonly string[];
};

export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

export function parseArgs(
  argv: readonly string[],
  command: string,
  definitions: readonly FlagDefinition[],
): ParsedArgs {
  const byToken = new Map<string, FlagDefinition>();
  for (const definition of definitions) {
    byToken.set(`--${definition.name}`, definition);
    if (definition.short !== undefined) byToken.set(`-${definition.short}`, definition);
  }

  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    if (positionalOnly) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }

    const equals = argument.indexOf("=");
    const token = equals < 0 ? argument : argument.slice(0, equals);
    const inlineValue = equals < 0 ? undefined : argument.slice(equals + 1);
    const definition = byToken.get(token);
    if (definition === undefined) {
      if (argument.startsWith("-")) {
        throw new ArgsError(`unknown flag "${token}" for "${command}"`);
      }
      positionals.push(argument);
      continue;
    }

    if (!definition.takesValue) {
      if (inlineValue !== undefined) {
        throw new ArgsError(`flag "${token}" does not take a value`);
      }
      flags[definition.name] = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("-"))) {
      throw new ArgsError(`flag "${token}" requires a value`);
    }
    flags[definition.name] = value;
    if (inlineValue === undefined) index += 1;
  }
  return { flags, positionals };
}

export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}
