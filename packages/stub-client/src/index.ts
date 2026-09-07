/**
 * Public surface of @om-code/stub-client (LRN-12, LRN-13).
 *
 * The port: the nine-method interface, the typed errors and the regex/glob/
 * path dialect contract — plus the local-ts driver behind it. The port
 * modules themselves still open no file and spawn no process (AC-12.5); all
 * host I/O lives in `drivers/local-ts`, the one module DoD-5 permits it.
 */

export {
  assertSupportedGlob,
  assertSupportedRegex,
  isInsideRoot,
} from "./dialect.js";
export {
  createLocalDriver,
  type LocalDriverOptions,
} from "./drivers/local-ts/driver.js";
export {
  isStubError,
  type NotImplementedMethod,
  notImplemented,
  StubError,
  type StubErrorKind,
} from "./errors.js";
export {
  STUB_METHODS,
  type StubClient,
  type StubMethod,
} from "./port.js";
