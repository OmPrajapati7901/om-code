/**
 * AC-16.5: the descriptor's parameters is the Zod schema's own
 * `z.toJSONSchema()` emit — one source shared with runtime validation, no
 * hand-written second copy (X-12).
 */

import type { ModelTool } from "@om-code/protocol";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  createGlobTool,
  createGrepTool,
  createReadTool,
  createRegistry,
  globInputSchema,
  grepInputSchema,
  readInputSchema,
  type Tool,
  type ToolDescriptor,
  toModelTool,
} from "../src/index.js";
import { fakeCapability, fakeEnd } from "./fixtures.js";

const inputSchema = z.object({ path: z.string(), limit: z.number().optional() }).strict();

function schemaTool(): { tool: Tool; descriptor: ToolDescriptor } {
  const descriptor: ToolDescriptor = {
    name: "read",
    version: "0.1.0",
    description: "fake read tool",
    risk_class: "read",
    parameters: z.toJSONSchema(inputSchema) as Record<string, unknown>,
  };
  return {
    descriptor,
    tool: {
      descriptor: () => descriptor,
      plan: async () => fakeCapability(),
      execute: () => fakeEnd(),
    },
  };
}

type EmittedSchema = {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
};

it("emits parameters from the Zod schema, not a second copy", () => {
  const { descriptor } = schemaTool();
  // Same source: byte-identical to a fresh emit.
  expect(descriptor.parameters).toEqual(z.toJSONSchema(inputSchema));
  // Cross-checked against the schema's own shape, so a hand-written copy
  // with a drifted key cannot pass.
  const emitted = descriptor.parameters as EmittedSchema;
  const shape = inputSchema.shape;
  expect(Object.keys(emitted.properties ?? {}).sort()).toEqual(Object.keys(shape).sort());
  const required = Object.entries(shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key)
    .sort();
  expect([...(emitted.required ?? [])].sort()).toEqual(required);
});

it("toModelTool reaches the prompt shape without translation", () => {
  const { tool } = schemaTool();
  const modelTool: ModelTool = toModelTool(tool.descriptor());
  expect(modelTool.name).toBe("read");
  expect(modelTool.description).toBe("fake read tool");
  expect(modelTool.parameters).toEqual(tool.descriptor().parameters);
});

it("real tool descriptors come from their runtime Zod schemas", () => {
  for (const [tool, schema] of [
    [createReadTool(), readInputSchema],
    [createGrepTool(), grepInputSchema],
    [createGlobTool(), globInputSchema],
  ] as const) {
    expect(tool.descriptor().parameters).toEqual(z.toJSONSchema(schema));
    const emitted = tool.descriptor().parameters as EmittedSchema;
    expect(Object.keys(emitted.properties ?? {}).sort()).toEqual(Object.keys(schema.shape).sort());
  }
});

it("the registry accepts all three real read-only tools", () => {
  const registry = createRegistry([createReadTool(), createGrepTool(), createGlobTool()]);
  expect(registry.descriptors().map(({ name }) => name)).toEqual(["read", "grep", "glob"]);
});
