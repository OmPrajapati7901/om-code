/**
 * LRN-09: the one module that assembles a `ModelRequest` (LR-FR-037).
 *
 * Pure by construction (AC-9.4): no clock, no filesystem, no network. The
 * caller resolves the environment, reads instruction files, and hashes them
 * before calling in — this module only renders and orders what it is given.
 *
 * AC-9.2 fixes the order of the system prompt: identity and rules, then
 * environment facts, then instruction files. Conversation and tool schemas
 * follow as `ModelRequest.messages`/`.tools` — `ModelRequest` has no `system`
 * field (protocol/src/model.ts), so the system prompt travels as the first
 * message instead.
 */

import type {
  AssistantMessage,
  CompleteToolCall,
  FileSnapshot,
  ModelMessage,
  ModelRequest,
  ModelTool,
  ToolResult,
  UserMessage,
} from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import { IDENTITY, RULES } from "./identity.js";

export type InstructionFile = {
  readonly path: string;
  readonly sha256: string;
  readonly content: string;
};

export type Environment = {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly os: string;
  readonly date: string;
};

export type PromptInput = {
  readonly session: SessionView;
  readonly model: string;
  readonly environment: Environment;
  readonly instructions: readonly InstructionFile[];
  readonly tools: readonly ModelTool[];
};

export type AssembledPrompt = {
  readonly request: ModelRequest;
  readonly systemPrompt: string;
  readonly instructions: readonly FileSnapshot[];
};

export type PromptErrorKind = "unsupported-entry" | "no-user-message";

export class PromptError extends Error {
  readonly kind: PromptErrorKind;
  constructor(kind: PromptErrorKind, message: string) {
    super(message);
    this.name = "PromptError";
    this.kind = kind;
  }
}

function renderIdentitySection(): string {
  const numbered = RULES.map((rule, index) => `${index + 1}. ${rule.text}`).join("\n");
  return `## Identity and rules\n\n${IDENTITY}\n\n${numbered}`;
}

function renderEnvironmentSection(environment: Environment): string {
  return [
    "## Environment",
    "",
    `- Working directory: ${environment.cwd}`,
    `- Project root: ${environment.projectRoot}`,
    `- OS: ${environment.os}`,
    `- Date: ${environment.date}`,
  ].join("\n");
}

function renderInstructionsSection(files: readonly InstructionFile[]): string {
  if (files.length === 0) {
    return "## Instruction files\n\nNone found.";
  }
  const blocks = files.map((file) => `### ${file.path}\n\n${file.content}`).join("\n\n");
  return `## Instruction files\n\n${blocks}`;
}

function assistantText(entry: AssistantMessage): string {
  if (entry.schemaVersion === 1) {
    return entry.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  // v2: an interrupted stream's tool_calls never executed, so they carry no
  // result to interleave and are safely dropped; only their text contributes.
  // A completed outcome's tool_calls are rendered by toModelMessages alongside
  // their tool results — this helper contributes the text half only.
  return entry.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Completed v2 calls always carry `call_id` and `name` — enforced by
 * `validateCalls` (protocol/src/model.ts) — so this narrowing is sound.
 */
function completeCallsOf(
  entry: Extract<AssistantMessage, { schemaVersion: 2 }>,
): CompleteToolCall[] {
  return entry.tool_calls as CompleteToolCall[];
}

function v1CallsOf(entry: Extract<AssistantMessage, { schemaVersion: 1 }>): CompleteToolCall[] {
  return entry.content
    .filter((block) => block.type === "tool_use")
    .map((block, index) => ({
      index,
      call_id: block.call_id,
      name: block.tool,
      arguments_raw: JSON.stringify(block.input),
    }));
}

function toolContent(result: ToolResult | undefined, callId: string): string {
  if (result !== undefined) return result.preview;
  // A pending call has no ToolResult yet. Every assistant `tool_calls` entry
  // still needs a matching `role: "tool"` message — an OpenAI-compatible
  // endpoint rejects the dangling assistant entry without one. Real
  // reconciliation (retry, re-issue, or explicit failure) is D-10 / LRN-29's
  // job; here we name the unknown outcome so the model can see the gap.
  return `[om: no result recorded yet for tool call ${callId}; outcome unknown]`;
}

function interleaveCalls(
  text: string,
  calls: readonly CompleteToolCall[],
  resultsByCallId: ReadonlyMap<string, ToolResult>,
): ModelMessage[] {
  const ordered = [...calls].sort((a, b) => a.index - b.index);
  const messages: ModelMessage[] = [{ role: "assistant", content: text, tool_calls: ordered }];
  for (const call of ordered) {
    messages.push({
      role: "tool",
      call_id: call.call_id,
      content: toolContent(resultsByCallId.get(call.call_id), call.call_id),
    });
  }
  return messages;
}

function toModelMessages(session: SessionView): ModelMessage[] {
  // toolCalls/toolResults live as parallel flat arrays with no per-entry seq,
  // so placement is reconstructed by walking the conversation in array order
  // and joining each assistant call to its result by call_id. A tool_result
  // whose call_id matches no assistant call is skipped: it cannot be placed
  // in the message stream, and inventing a placement would corrupt ordering.
  const resultsByCallId = new Map<string, ToolResult>();
  for (const result of session.toolResults) {
    if (!resultsByCallId.has(result.call_id)) resultsByCallId.set(result.call_id, result);
  }
  const hasUserMessage = session.conversation.some((entry) => entry.kind === "user_message");
  if (!hasUserMessage) {
    throw new PromptError("no-user-message", "conversation has no user message to answer");
  }
  const messages: ModelMessage[] = [];
  for (const entry of session.conversation) {
    if (entry.kind === "user_message") {
      messages.push({ role: "user", content: (entry as UserMessage).text });
      continue;
    }
    const text = assistantText(entry);
    if (entry.schemaVersion === 2) {
      if (entry.outcome.kind === "interrupted") {
        messages.push({ role: "assistant", content: text });
        continue;
      }
      if (entry.tool_calls.length > 0) {
        messages.push(...interleaveCalls(text, completeCallsOf(entry), resultsByCallId));
        continue;
      }
      messages.push({ role: "assistant", content: text });
      continue;
    }
    const v1Calls = v1CallsOf(entry);
    if (v1Calls.length > 0) {
      messages.push(...interleaveCalls(text, v1Calls, resultsByCallId));
      continue;
    }
    messages.push({ role: "assistant", content: text });
  }
  return messages;
}

export function assemblePrompt(input: PromptInput): AssembledPrompt {
  const systemPrompt = [
    renderIdentitySection(),
    renderEnvironmentSection(input.environment),
    renderInstructionsSection(input.instructions),
  ].join("\n\n");

  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    ...toModelMessages(input.session),
  ];

  const request: ModelRequest = {
    model: input.model,
    messages,
    ...(input.tools.length > 0 ? { tools: input.tools } : {}),
  };

  return {
    request,
    systemPrompt,
    instructions: input.instructions.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
}
