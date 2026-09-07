/** Stable public CLI exit codes (blueprint §8.1). */
export const EXIT = {
  ok: 0,
  error: 1,
  // Produced only after policy and approval routing land in LRN-22.
  needsApproval: 2,
  limit: 3,
  // Produced only after policy and approval routing land in LRN-22.
  denied: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
