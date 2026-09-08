import type { ConfigSnapshot } from "../protocol/types";
import type { ErrorCode } from "./errors";
export type Phase =
  | "disconnected"
  | "choosing"
  | "connecting"
  | "subscribing"
  | "reading"
  | "ready"
  | "preparing"
  | "confirming"
  | "saving"
  | "committing"
  | "verifying"
  | "error";
export interface OperationState {
  phase: Phase;
  snapshot: ConfigSnapshot | null;
  error: ErrorCode | null;
  verified: boolean;
  progress: number;
  notificationLength: number | null;
  log: ReadonlyArray<{ time: string; event: string }>;
}
