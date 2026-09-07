import type { Transition } from "../../src/index.js";

// Each marker proves that a forbidden edge is rejected by the compiler. The
// runtime test pins the marker count so this evidence cannot silently vanish.
// @ts-expect-error idle can only begin building context
export type IdleToCompleted = Transition<"idle", "completed">;
// @ts-expect-error idle cannot skip directly to the model
export type IdleToWaiting = Transition<"idle", "waiting_for_model">;
// @ts-expect-error prompt construction cannot complete the turn
export type BuildingToCompleted = Transition<"building_context", "completed">;
// @ts-expect-error waiting cannot skip streaming
export type WaitingToYield = Transition<"waiting_for_model", "yield_candidate">;
// @ts-expect-error streaming cannot move backward
export type StreamingToWaiting = Transition<"streaming_model", "waiting_for_model">;
// @ts-expect-error a yield candidate must commit completion
export type YieldToFailed = Transition<"yield_candidate", "failed">;
// @ts-expect-error completed is terminal
export type CompletedToIdle = Transition<"completed", "idle">;
// @ts-expect-error failed is terminal
export type FailedToCompleted = Transition<"failed", "completed">;
// @ts-expect-error interrupted is terminal
export type InterruptedToIdle = Transition<"interrupted", "idle">;
