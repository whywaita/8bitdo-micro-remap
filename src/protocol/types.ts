import type { ButtonId } from "./buttons";
export type Modifier = "ctrl" | "alt" | "shift" | "meta";
export interface HidChord {
  kind: "chord";
  modifiers: Modifier[];
  key: number | null;
}
export interface UnknownHidMapping {
  kind: "unknown";
  raw: Uint8Array;
}
export type DecodedMapping = HidChord | UnknownHidMapping;
export interface ConfigSnapshot {
  raw: Uint8Array;
  mappings: Readonly<Record<ButtonId, DecodedMapping>>;
  disableSleep: boolean | null;
}
export interface ConfigEdits {
  mappings: Partial<Record<ButtonId, HidChord>>;
  disableSleep?: boolean;
}
