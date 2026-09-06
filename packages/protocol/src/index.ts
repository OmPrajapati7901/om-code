/**
 * Public surface of @om-code/protocol (LRN-05, LR-FR-001).
 *
 * The wire-schema authority: journal envelope, entries, capability and
 * session types. Depends on nothing but zod — never on another workspace
 * package (AC-5.6).
 */

export {
  type CapabilityRequest,
  capabilityRequestSchema,
} from "./capability.js";
export {
  type AssistantMessage,
  assistantMessageV1,
  type Block,
  blockSchema,
  type Checkpoint,
  type Compaction,
  checkpointV1,
  compactionV1,
  ENTRY_KINDS,
  ENTRY_SCHEMAS,
  type Entry,
  type EntryKind,
  type FileSnapshot,
  fileSnapshotSchema,
  imageBlockSchema,
  type Permission,
  type Prompt,
  permissionV1,
  promptV1,
  type Repair,
  repairV1,
  type SessionStart,
  type StructuredSummary,
  sessionStartV1,
  structuredSummarySchema,
  type ToolCall,
  type ToolResult,
  type TurnEnd,
  textBlockSchema,
  thinkingBlockSchema,
  toolCallV1,
  toolResultV1,
  toolUseBlockSchema,
  turnEndV1,
  type UserMessage,
  userMessageV1,
} from "./entries.js";
export {
  invalidEntry,
  invalidRecord,
  isProtocolError,
  ProtocolError,
  type ProtocolErrorKind,
  unknownSchemaVersion,
} from "./errors.js";
export {
  type AssistantMessageV2,
  assistantMessageV2,
  type CompleteToolCall,
  isProviderError,
  type ModelEvent,
  type ModelMessage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelTool,
  modelResponseSchema,
  ProviderError,
  type ProviderErrorKind,
  type RawToolCall,
  rawToolCallSchema,
  type StreamFailureKind,
} from "./model.js";
export {
  type Actor,
  actorSchema,
  recordIdSchema,
  seqSchema,
  sha256Schema,
  type ToolStatus,
  timestampSchema,
  toolStatusSchema,
  type Usage,
  usageKnownSchema,
  usageSchema,
  usageUnknownSchema,
} from "./primitives.js";
export {
  ENVELOPE_VERSION,
  type Envelope,
  envelopeSchema,
  type JournalRecord,
  type ParseFailure,
  type ParseResult,
  type ParseSuccess,
  parseRecord,
  type ReadableRecord,
  type UnknownEntry,
  type UnknownEntryRecord,
} from "./record.js";
export {
  type ModelRef,
  modelRefSchema,
  type SessionMeta,
  type SessionMode,
  type SessionStatus,
  sessionMetaSchema,
  sessionModeSchema,
  sessionStatusSchema,
} from "./session.js";
