// Planted-violation fixture (AC-8.5 failure path). Swallows the guard's
// throw on purpose to prove the guard still fails the run via its exit
// handler, not just via an uncaught exception.
try {
  await fetch("https://example.invalid/");
} catch {
  // intentionally swallowed
}
