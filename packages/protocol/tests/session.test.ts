/**
 * SessionMeta and ModelRef: the five-mode vocabulary, the credential guard
 * (LR-FR-030 at the schema level), and the field validations.
 */

import { describe, expect, it } from "vitest";
import { modelRefSchema, parseRecord, sessionMetaSchema } from "../src/index.js";
import { makeRecord, validMeta } from "./fixtures.js";

describe("session", () => {
  it("accepts a valid SessionMeta", () => {
    expect(sessionMetaSchema.safeParse(validMeta()).success).toBe(true);
  });

  it("keeps all five mode values so journals outlive this release's CLI", () => {
    for (const mode of ["plan", "manual", "accept_edits", "auto", "bypass"]) {
      expect(sessionMetaSchema.safeParse({ ...validMeta(), mode }).success).toBe(true);
    }
    expect(sessionMetaSchema.safeParse({ ...validMeta(), mode: "read_only" }).success).toBe(false);
  });

  it("rejects a SessionMeta carrying a credential (LR-FR-030 schema guard)", () => {
    const withCredential = { ...validMeta(), credential: "env:OM_API_KEY" };
    const direct = sessionMetaSchema.safeParse(withCredential);
    expect(direct.success).toBe(false);
    const viaRecord = parseRecord(
      makeRecord({ kind: "session_start", schemaVersion: 1, meta: withCredential }),
    );
    expect(viaRecord.ok).toBe(false);
    if (!viaRecord.ok) {
      expect(viaRecord.error.kind).toBe("invalid-entry");
      expect(viaRecord.error.message).toContain("meta");
    }
  });

  it("accepts every status and the optional sandbox_profile, name and tags", () => {
    for (const status of ["active", "idle", "ended"]) {
      expect(sessionMetaSchema.safeParse({ ...validMeta(), status }).success).toBe(true);
    }
    expect(
      sessionMetaSchema.safeParse({
        ...validMeta(),
        name: "auth hunt",
        sandbox_profile: "om-stub-v1",
        tags: ["m2"],
      }).success,
    ).toBe(true);
  });

  it("requires project_root, cwd, model, tags and RFC-3339 timestamps", () => {
    const meta = validMeta();
    delete meta.project_root;
    expect(sessionMetaSchema.safeParse(meta).success).toBe(false);
    expect(sessionMetaSchema.safeParse({ ...validMeta(), created_at: "yesterday" }).success).toBe(
      false,
    );
    expect(modelRefSchema.safeParse({ id: "m" }).success).toBe(false);
    expect(modelRefSchema.safeParse({ id: "m", base_url: "https://x.test" }).success).toBe(true);
  });
});
