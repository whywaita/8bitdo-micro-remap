import { BUTTONS, BUTTON_BY_ID, isButtonId } from "./buttons";
import {
  CONFIG_LENGTH,
  PAGE_LENGTH,
  PAGE_OFFSETS,
  DISABLE_SLEEP_OFFSET,
} from "./constants";
import { decodeChord, encodeChord } from "./hid-codec";
import { ProtocolError } from "./errors";
import type { ConfigPage } from "./packets";
import type { ConfigEdits, ConfigSnapshot } from "./types";
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
export function assembleConfigPages(pages: Iterable<ConfigPage>): Uint8Array {
  const seen = new Map<number, Uint8Array>();
  for (const { offset, payload } of pages) {
    if (
      !(PAGE_OFFSETS as readonly number[]).includes(offset) ||
      payload.length !== PAGE_LENGTH
    )
      throw new ProtocolError("INVALID_PACKET");
    const prior = seen.get(offset);
    if (prior && !equalBytes(prior, payload))
      throw new ProtocolError("CONFLICTING_PAGE");
    seen.set(offset, payload.slice());
  }
  if (seen.size !== 4) throw new ProtocolError("INCOMPLETE_CONFIG");
  const result = new Uint8Array(CONFIG_LENGTH);
  for (const [offset, payload] of seen) result.set(payload, offset);
  return result;
}
export function parseConfig(payload: Uint8Array): ConfigSnapshot {
  if (payload.length !== CONFIG_LENGTH)
    throw new ProtocolError("INCOMPLETE_CONFIG");
  const raw = payload.slice();
  const sleep = raw[DISABLE_SLEEP_OFFSET];
  return {
    raw,
    mappings: Object.fromEntries(
      BUTTONS.map((b) => [
        b.id,
        decodeChord(raw.slice(b.offset, b.offset + 4)),
      ]),
    ) as ConfigSnapshot["mappings"],
    disableSleep: sleep === 0 ? false : sleep === 1 ? true : null,
  };
}
export function applyConfigEdits(
  baseline: ConfigSnapshot,
  edits: ConfigEdits,
): Uint8Array {
  const result = parseConfig(baseline.raw).raw;
  for (const [id, chord] of Object.entries(edits.mappings)) {
    if (!isButtonId(id)) throw new ProtocolError("INVALID_MAPPING");
    result.set(encodeChord(chord), BUTTON_BY_ID[id].offset);
  }
  if (edits.disableSleep !== undefined) {
    if (
      typeof edits.disableSleep !== "boolean" ||
      ![0, 1].includes(result[DISABLE_SLEEP_OFFSET]!)
    )
      throw new ProtocolError("INVALID_MAPPING");
    result[DISABLE_SLEEP_OFFSET] = edits.disableSleep ? 1 : 0;
  }
  return result;
}
