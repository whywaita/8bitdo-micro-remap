export type ProtocolErrorCode =
  | "INVALID_PACKET"
  | "INVALID_CRC"
  | "INCOMPLETE_CONFIG"
  | "CONFLICTING_PAGE"
  | "INVALID_MAPPING";
export class ProtocolError extends Error {
  constructor(public readonly code: ProtocolErrorCode) {
    super(code);
    this.name = "ProtocolError";
  }
}
