/**
 * CapabilityRequest (LRN-05, blueprint §8.3).
 *
 * Consumed unchanged by LRN-16's Tool.plan() and LRN-21's policy engine. The
 * `network` key exists as z.never() so a record requesting network fails
 * loudly naming D-01 rather than being silently dropped by .strict().
 */

import { z } from "zod";

export const capabilityRequestSchema = z
  .object({
    process: z
      .object({
        program: z.string().min(1),
        argv: z.array(z.string()),
        cwd: z.string().min(1),
        shell: z.enum(["bash", "zsh"]).optional(),
      })
      .strict()
      .optional(),
    filesystem: z
      .object({
        read: z.array(z.string()),
        write: z.array(z.string()),
      })
      .strict()
      .optional(),
    network: z.never().optional(),
    risk_class: z.enum(["read", "write_workspace", "exec", "destructive"]),
  })
  .strict();

export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;
