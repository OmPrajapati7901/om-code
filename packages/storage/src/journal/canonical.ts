/**
 * LRN-06 entry encoding: JSON scalars with RFC 8785 UTF-16 property ordering.
 * Emit properties directly: JSON.stringify(object) reorders integer-like keys.
 * Hash the original JSON entry, never parseRecord's unknown_entry wrapper.
 * Optional undefined object properties are omitted; arrays cannot have holes.
 * No toJSON hooks, getters, symbols, nonfinite numbers or lone surrogates.
 */
import { createHash } from "node:crypto";
import { JournalError } from "./errors.js";

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const invalid = (): never => {
    throw new JournalError("invalid-value", "journal value must be JSON-compatible");
  };
  const string = (text: string): string =>
    /[\uD800-\uDFFF]/u.test(text) ? invalid() : JSON.stringify(text);
  function encode(item: unknown): string {
    if (item === null) return "null";
    if (typeof item === "string") return string(item);
    if (typeof item === "boolean") return String(item);
    if (typeof item === "number") return Number.isFinite(item) ? JSON.stringify(item) : invalid();
    if (typeof item !== "object" || ancestors.has(item)) return invalid();
    if (Object.getOwnPropertySymbols(item).length !== 0) return invalid();
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length) return invalid();
        const parts: string[] = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !("value" in descriptor)) return invalid();
          parts.push(encode(descriptor.value));
        }
        return `[${parts.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return invalid();
      const parts: string[] = [];
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) return invalid();
        if (descriptor.value !== undefined)
          parts.push(`${string(key)}:${encode(descriptor.value)}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

export function hashEntry(entry: unknown): string {
  return createHash("sha256").update(canonicalJson(entry)).digest("hex");
}
