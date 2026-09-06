/**
 * LRN-09 acceptance: AC-9.1 (single-module lint lives in tests/boundaries.test.ts),
 * AC-9.2 (section order), AC-9.3 (readable snapshot), AC-9.4 (purity),
 * AC-9.5 (instruction hashes, journalable), AC-9.6 (every rule has a why).
 */

import { promptV1 } from "@om-code/protocol";
import { describe, expect, it } from "vitest";
import { assemblePrompt, type PromptInput, RULES } from "../src/index.js";
import {
  assistantTextV1,
  assistantTextV2,
  baseSession,
  FIXED_ENVIRONMENT,
  FIXED_INSTRUCTIONS,
  FIXED_TOOLS,
  userMessage,
} from "./fixtures.js";

function fixedInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    session: baseSession([userMessage("where is auth handled?"), assistantTextV1("Not sure yet.")]),
    model: "qwen/qwen3.8-27b",
    environment: FIXED_ENVIRONMENT,
    instructions: FIXED_INSTRUCTIONS,
    tools: FIXED_TOOLS,
    ...overrides,
  };
}

function renderForSnapshot(input: PromptInput): string {
  const assembled = assemblePrompt(input);
  const messageLines = assembled.request.messages
    .map((message) => {
      if (message.role === "system") return "[system] (see === system prompt === above)";
      if (message.role === "tool") return `[tool ${message.call_id}] ${message.content}`;
      return `[${message.role}] ${message.content}`;
    })
    .join("\n");
  const toolLines = (assembled.request.tools ?? [])
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
  return [
    "=== system prompt ===",
    assembled.systemPrompt,
    "",
    "=== messages ===",
    messageLines,
    "",
    "=== tools ===",
    toolLines || "(none)",
  ].join("\n");
}

describe("assemblePrompt", () => {
  it("pins the exact assembled prompt for a fixed session (AC-9.3)", async () => {
    await expect(renderForSnapshot(fixedInput())).toMatchFileSnapshot("__snapshots__/prompt.txt");
  });

  it("orders identity+rules, environment, instructions, then conversation (AC-9.2)", () => {
    const assembled = assemblePrompt(fixedInput());
    const identityIndex = assembled.systemPrompt.indexOf("## Identity and rules");
    const environmentIndex = assembled.systemPrompt.indexOf("## Environment");
    const instructionsIndex = assembled.systemPrompt.indexOf("## Instruction files");
    expect(identityIndex).toBe(0);
    expect(environmentIndex).toBeGreaterThan(identityIndex);
    expect(instructionsIndex).toBeGreaterThan(environmentIndex);

    expect(assembled.request.messages[0]).toMatchObject({ role: "system" });
    expect(assembled.request.messages[1]).toMatchObject({
      role: "user",
      content: "where is auth handled?",
    });
    expect(assembled.request.messages[2]).toMatchObject({ role: "assistant" });
    expect(assembled.request.tools).toEqual(FIXED_TOOLS);
  });

  it("is a pure function of its input — same input, same output (AC-9.4)", () => {
    const a = assemblePrompt(fixedInput());
    const b = assemblePrompt(fixedInput());
    expect(a).toEqual(b);
  });

  it("changes output only because the date was passed in, never read live (AC-9.4)", () => {
    const first = assemblePrompt(fixedInput());
    const second = assemblePrompt(
      fixedInput({ environment: { ...FIXED_ENVIRONMENT, date: "2099-01-01" } }),
    );
    expect(first.systemPrompt).not.toEqual(second.systemPrompt);
    expect(second.systemPrompt).toContain("2099-01-01");
  });

  it("reports instruction files by content hash for journaling (AC-9.5)", () => {
    const assembled = assemblePrompt(fixedInput());
    expect(assembled.instructions).toEqual([
      { path: "AGENTS.md", sha256: "1".repeat(64) },
      { path: "CLAUDE.md", sha256: "2".repeat(64) },
    ]);
    const entry = {
      kind: "prompt" as const,
      schemaVersion: 1 as const,
      instructions: assembled.instructions,
    };
    expect(promptV1.safeParse(entry).success).toBe(true);
  });

  it("every rule carries a non-empty why, so it can be deleted with confidence (AC-9.6)", () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const rule of RULES) {
      expect(rule.text.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });

  it("accepts a v2 assistant message whose stream was interrupted before any tool ran", () => {
    const assembled = assemblePrompt(
      fixedInput({
        session: baseSession([
          userMessage("keep going"),
          {
            kind: "assistant_message",
            schemaVersion: 2,
            content: [{ type: "text", text: "partial answer" }],
            tool_calls: [{ index: 0, arguments_raw: "" }],
            usage: { kind: "unknown" },
            outcome: { kind: "interrupted", reason: "disconnected" },
          },
        ]),
      }),
    );
    expect(assembled.request.messages[2]).toMatchObject({
      role: "assistant",
      content: "partial answer",
    });
  });

  it("renders with no instruction files and no tools", () => {
    const assembled = assemblePrompt(fixedInput({ instructions: [], tools: [] }));
    expect(assembled.systemPrompt).toContain("None found.");
    expect(assembled.request.tools).toBeUndefined();
  });

  describe("failure paths (DoD-2)", () => {
    it("throws naming LRN-18 when the snapshot has a v1 tool_use block", () => {
      expect(() =>
        assemblePrompt(
          fixedInput({
            session: baseSession([
              userMessage("go"),
              {
                kind: "assistant_message",
                schemaVersion: 1,
                content: [
                  { type: "tool_use", call_id: "call_1", tool: "grep", input: { pattern: "x" } },
                ],
                usage: { kind: "unknown" },
              },
            ]),
          }),
        ),
      ).toThrow(/LRN-18/);
    });

    it("throws naming LRN-18 when a v2 assistant message completed with tool_calls", () => {
      expect(() =>
        assemblePrompt(
          fixedInput({
            session: baseSession([
              userMessage("go"),
              {
                kind: "assistant_message",
                schemaVersion: 2,
                content: [],
                tool_calls: [{ index: 0, call_id: "call_1", name: "grep", arguments_raw: "{}" }],
                usage: { kind: "unknown" },
                outcome: { kind: "complete" },
              },
            ]),
          }),
        ),
      ).toThrow(/LRN-18/);
    });

    it("throws naming LRN-18 when the session carries separate tool_call/tool_result entries", () => {
      const session = baseSession([userMessage("go"), assistantTextV2("ok")]);
      session.toolCalls.push({
        kind: "tool_call",
        schemaVersion: 1,
        call_id: "call_1",
        tool: "grep",
        input: {},
        capability: { filesystem: { read: [], write: [] }, risk_class: "read" },
      });
      expect(() => assemblePrompt(fixedInput({ session }))).toThrow(/LRN-18/);
    });

    it("throws when there is no user message to answer", () => {
      expect(() =>
        assemblePrompt(fixedInput({ session: baseSession([assistantTextV1("hello?")]) })),
      ).toThrow(/no user message/);
    });
  });
});
