import type { StubFrame, ToolStatus } from "@om-code/protocol";
import type { ToolEvent } from "./tool.js";

const TOOL_STATUS: Record<StubFrame["status"], ToolStatus> = {
  ok: "ok",
  failed: "error",
  timeout: "timeout",
  denied: "denied",
};

export function toToolStatus(status: StubFrame["status"]): ToolStatus {
  return TOOL_STATUS[status];
}

export function endEvent(frame: StubFrame, preview: string): ToolEvent {
  return {
    type: "end",
    result: {
      status: toToolStatus(frame.status),
      preview,
      bytes: frame.bytes,
      truncated: frame.truncated,
    },
  };
}
