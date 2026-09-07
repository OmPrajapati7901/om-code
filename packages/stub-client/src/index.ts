/**
 * Public surface of @om-code/stub-client (LRN-12).
 *
 * The port (contract only): the nine-method interface, the typed errors and
 * the regex/glob/path dialect contract. No driver code — nothing here opens
 * a file or spawns a process (AC-12.5).
 */

export {
  assertSupportedGlob,
  assertSupportedRegex,
  isInsideRoot,
} from "./dialect.js";
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
