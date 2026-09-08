/**
 * LRN-14 (AC-14.4): dependency direction from blueprint section 6.
 *
 * protocol <- session <- kernel, with {providers, storage, stub-client,
 * sandbox, tools, context} as adapters below kernel and cli composing them.
 * The adapters rule is one generated rule per adapter (`<name>-does-not-cross`):
 * a single from/to regex pair cannot distinguish a cross-adapter edge from a
 * package importing its own files, so each rule forbids one adapter from
 * reaching every other adapter plus cli. `policy` joined the adapter set in
 * LRN-21d (it exists since LRN-21a); every listed adapter now has sources.
 *
 * Both `src` and `dist` would appear in the graph (workspace imports
 * resolve to `dist` under plain node resolution), so every package pattern
 * matches both trees — but `lint:deps` passes `--exclude "dist"`: generated
 * output adds no signal, since any violation in it originates in `src`.
 * `tsconfig.depcruise.json` maps workspace imports back to `src`, so the
 * gate lints what is written and needs no build first (a fresh clone has
 * no `dist/`). `tests/` is cruised but unconstrained as a from-side: tests
 * legitimately import everything.
 */
const ADAPTERS = ["providers", "storage", "stub-client", "sandbox", "tools", "context", "policy"];

const adapterRules = ADAPTERS.map((adapter) => {
  const others = ADAPTERS.filter((name) => name !== adapter);
  return {
    name: `${adapter}-does-not-cross`,
    comment: `${adapter} never imports another adapter or the cli composition root.`,
    severity: "error",
    from: { path: `^packages/${adapter}/(src|dist)` },
    to: { path: `^packages/(${[...others, "cli"].join("|")})/` },
  };
});

module.exports = {
  forbidden: [
    {
      name: "protocol-is-a-leaf",
      comment: "AC-5.6: protocol imports nothing from any other workspace package.",
      severity: "error",
      from: { path: "^packages/protocol/(src|dist)" },
      to: { path: "^packages/(?!protocol/)" },
    },
    {
      name: "session-only-protocol",
      comment: "session depends on protocol only.",
      severity: "error",
      from: { path: "^packages/session/(src|dist)" },
      to: { path: "^packages/(?!protocol/|session/)" },
    },
    {
      name: "kernel-ports-only",
      comment: "AC-10.5: kernel imports no provider, sandbox, storage or stub-client.",
      severity: "error",
      from: { path: "^packages/kernel/(src|dist)" },
      to: { path: "^packages/(?!protocol/|session/|kernel/)" },
    },
    ...adapterRules,
    {
      name: "nothing-depends-on-cli",
      comment: "cli is the composition root; nothing imports it.",
      severity: "error",
      from: { path: "^packages/(?!cli/)" },
      to: { path: "^packages/cli/" },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles anywhere in the graph.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
  },
};
