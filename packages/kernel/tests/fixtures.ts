import type { AssistantMessage, ModelTool, UserMessage } from "@om-code/protocol";
import type { SessionView } from "@om-code/session";
import type { Environment, InstructionFile } from "../src/index.js";

export function baseSession(conversation: SessionView["conversation"] = []): SessionView {
  return {
    meta: undefined,
    lastSeq: 0,
    lastActivityAt: undefined,
    conversation,
    toolCalls: [],
    toolResults: [],
    pendingCallIds: [],
    permissions: [],
    checkpoints: [],
    compactions: [],
    repairs: [],
    prompts: [],
    unknownEntries: [],
    diagnostics: [],
    resumable: false,
  };
}

export function userMessage(text: string): UserMessage {
  return { kind: "user_message", schemaVersion: 1, text };
}

export function assistantTextV1(text: string): AssistantMessage {
  return {
    kind: "assistant_message",
    schemaVersion: 1,
    content: [{ type: "text", text }],
    usage: { kind: "unknown" },
  };
}

export function assistantTextV2(text: string): AssistantMessage {
  return {
    kind: "assistant_message",
    schemaVersion: 2,
    content: [{ type: "text", text }],
    tool_calls: [],
    usage: { kind: "unknown" },
    outcome: { kind: "complete" },
  };
}

export const FIXED_ENVIRONMENT: Environment = {
  cwd: "/Users/dev/projects/om-code",
  projectRoot: "/Users/dev/projects/om-code",
  os: "darwin/arm64",
  date: "2026-09-06",
};

export const FIXED_INSTRUCTIONS: readonly InstructionFile[] = [
  {
    path: "AGENTS.md",
    sha256: "1".repeat(64),
    content: "# Repository Guidelines\n\nKeep changes small.",
  },
  {
    path: "CLAUDE.md",
    sha256: "2".repeat(64),
    content: "@AGENTS.md",
  },
];

export const FIXED_TOOLS: readonly ModelTool[] = [
  {
    name: "grep",
    description: "Search file contents by pattern.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
];
