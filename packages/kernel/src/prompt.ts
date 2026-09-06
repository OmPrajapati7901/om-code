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
  FileSnapshot,
  ModelMessage,
  ModelRequest,
  ModelTool,
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
    if (entry.content.some((block) => block.type === "tool_use")) {
      throw new PromptError(
        "unsupported-entry",
        "assistant_message v1 carries a tool_use block; interleaving tool " +
          "results into the conversation is LRN-18's job, not LRN-09's.",
      );
    }
    return entry.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  // v2: tool_calls that actually completed need their tool results
  // interleaved (role: "tool" messages) before the model can see them
  // again — that mapping is LRN-18. An interrupted stream's tool_calls
  // never executed, so they carry no result to interleave and are safely
  // dropped; only their text contributes.
  if (entry.outcome.kind === "complete" && entry.tool_calls.length > 0) {
    throw new PromptError(
      "unsupported-entry",
      "assistant_message v2 carries completed tool_calls; interleaving " +
        "tool results into the conversation is LRN-18's job, not LRN-09's.",
    );
  }
  return entry.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toModelMessages(session: SessionView): ModelMessage[] {
  if (session.toolCalls.length > 0 || session.toolResults.length > 0) {
    throw new PromptError(
      "unsupported-entry",
      "session has tool_call/tool_result entries; interleaving them into " +
        "the conversation is LRN-18's job, not LRN-09's.",
    );
  }
  const hasUserMessage = session.conversation.some((entry) => entry.kind === "user_message");
  if (!hasUserMessage) {
    throw new PromptError("no-user-message", "conversation has no user message to answer");
  }
  return session.conversation.map((entry): ModelMessage => {
    if (entry.kind === "user_message") {
      return { role: "user", content: (entry as UserMessage).text };
    }
    return { role: "assistant", content: assistantText(entry) };
  });
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
