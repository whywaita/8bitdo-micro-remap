import { ProtocolError } from "./errors";
import type { Modifier, HidChord, DecodedMapping } from "./types";
// USB HID Usage Tables 1.6, Keyboard/Keypad page (0x07); protocol facts only.
// https://www.usb.org/sites/default/files/hut1_6.pdf
export const MODIFIERS: readonly Modifier[] = ["ctrl", "alt", "shift", "meta"];
const usage: Record<Modifier, number> = {
  ctrl: 0xe0,
  alt: 0xe2,
  shift: 0xe1,
  meta: 0xe3,
};
const modifierLabels: Record<Modifier, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
};
export const KEY_LABELS: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries([
    ...Array.from({ length: 26 }, (_, i) => [
      4 + i,
      String.fromCharCode(65 + i),
    ]),
    ...Array.from({ length: 10 }, (_, i) => [30 + i, String((i + 1) % 10)]),
    ...[
      "Enter",
      "Escape",
      "Backspace",
      "Tab",
      "Space",
      "-",
      "=",
      "[",
      "]",
      "\\",
      "Non-US #",
      ";",
      "'",
      "`",
      ",",
      ".",
      "/",
      "Caps Lock",
    ].map((s, i) => [40 + i, s]),
    ...Array.from({ length: 12 }, (_, i) => [58 + i, `F${i + 1}`]),
    ...[
      "Print Screen",
      "Scroll Lock",
      "Pause",
      "Insert",
      "Home",
      "Page Up",
      "Delete",
      "End",
      "Page Down",
      "Right",
      "Left",
      "Down",
      "Up",
      "Num Lock",
      "Keypad /",
      "Keypad *",
      "Keypad -",
      "Keypad +",
      "Keypad Enter",
      "Keypad 1",
      "Keypad 2",
      "Keypad 3",
      "Keypad 4",
      "Keypad 5",
      "Keypad 6",
      "Keypad 7",
      "Keypad 8",
      "Keypad 9",
      "Keypad 0",
      "Keypad .",
      "Non-US \\",
      "Application",
    ].map((s, i) => [70 + i, s]),
    [103, "Keypad ="],
    ...Array.from({ length: 12 }, (_, i) => [104 + i, `F${i + 13}`]),
  ]),
);
export function encodeChord(chord: HidChord): Uint8Array {
  if (
    chord.kind !== "chord" ||
    !Array.isArray(chord.modifiers) ||
    chord.modifiers.some((m) => !MODIFIERS.includes(m)) ||
    new Set(chord.modifiers).size !== chord.modifiers.length ||
    (chord.key !== null &&
      (!Number.isInteger(chord.key) ||
        !Object.hasOwn(KEY_LABELS, chord.key))) ||
    chord.modifiers.length + (chord.key === null ? 0 : 1) > 4
  )
    throw new ProtocolError("INVALID_MAPPING");
  const values = MODIFIERS.filter((m) => chord.modifiers.includes(m)).map(
    (m) => usage[m],
  );
  if (chord.key !== null) values.push(chord.key);
  const result = new Uint8Array(4);
  result.set(values);
  return result;
}
export function decodeChord(bytes: Uint8Array): DecodedMapping {
  if (bytes.length !== 4) throw new ProtocolError("INVALID_MAPPING");
  const modifiers: Modifier[] = [];
  const keys: number[] = [];
  for (const byte of bytes) {
    if (byte === 0) continue;
    const modifier = MODIFIERS.find((m) => usage[m] === byte);
    if (modifier) modifiers.push(modifier);
    else keys.push(byte);
  }
  if (
    keys.length > 1 ||
    keys.some((k) => !Object.hasOwn(KEY_LABELS, k)) ||
    new Set(modifiers).size !== modifiers.length
  )
    return { kind: "unknown", raw: bytes.slice() };
  return {
    kind: "chord",
    modifiers: MODIFIERS.filter((m) => modifiers.includes(m)),
    key: keys[0] ?? null,
  };
}
export function formatChord(value: DecodedMapping): string {
  if (value.kind === "unknown")
    return Array.from(
      value.raw,
      (b) => `0x${b.toString(16).padStart(2, "0").toUpperCase()}`,
    ).join(" ");
  return (
    [
      ...value.modifiers.map((m) => modifierLabels[m]),
      ...(value.key === null ? [] : [KEY_LABELS[value.key]]),
    ].join(" + ") || "無効"
  );
}
