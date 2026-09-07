/**
 * Public surface of @om-code/storage (LRN-04).
 *
 * Config file schemas stay here, not in packages/protocol: protocol is the
 * wire authority (AGENTS.md), and a local config file is not a wire contract.
 */

export {
  type BlobLocation,
  blobFileForRef,
  createBlobStore,
  putBlob,
  readBlob,
  resolveBlobHome,
} from "./blobs/store.js";
export { type KeychainRunner, resolveCredentialSecret } from "./config/credential.js";
export { ConfigError, isConfigError } from "./config/errors.js";
export {
  type LoadSettingsOptions,
  loadSettings,
  type RuntimeSettings,
  requireComplete,
} from "./config/loader.js";
export {
  type ConfigPaths,
  findGitRoot,
  findProjectRoot,
  resolveConfigPaths,
  resolveOmHome,
} from "./config/paths.js";
export {
  type FileReader,
  parseTierDocument,
  readTierFile,
  type TierDocument,
} from "./config/read.js";
export {
  type ResolvedEntry,
  type ResolvedSettings,
  type ResolveInput,
  resolveSettings,
  type Tier,
} from "./config/resolve.js";
export {
  type ConfigFlags,
  type CredentialReference,
  CredentialSecret,
  parseBaseUrl,
  parseCredentialReference,
  parseModel,
  SETTINGS,
  type SettingKey,
} from "./config/settings.js";
export { isJournalError, JournalError, type JournalErrorKind } from "./journal/errors.js";
export { type JournalLocation, type JournalPaths, journalPaths } from "./journal/files.js";
export { type ListedSession, listSessions } from "./journal/list.js";
export { type JournalRead, JournalReader, type TailDiagnostic } from "./journal/reader.js";
export {
  type AppendContext,
  type JournalHooks,
  type JournalStage,
  JournalWriter,
  type JournalWriterOptions,
} from "./journal/writer.js";
