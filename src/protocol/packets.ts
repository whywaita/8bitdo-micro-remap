import {
  CONFIG_LENGTH,
  PAGE_LENGTH,
  PAGE_OFFSETS,
  READ_RESPONSE_LENGTH,
  WRITE_PACKET_LENGTH,
} from "./constants";
import { crc16 } from "./crc16";
import { ProtocolError } from "./errors";
export interface ConfigPage {
  offset: (typeof PAGE_OFFSETS)[number];
  payload: Uint8Array;
}
function isOffset(offset: number): offset is ConfigPage["offset"] {
  return (PAGE_OFFSETS as readonly number[]).includes(offset);
}
export function buildWritePage(
  offset: number,
  payload: Uint8Array,
): Uint8Array {
  if (!isOffset(offset) || payload.length !== PAGE_LENGTH)
    throw new ProtocolError("INVALID_PACKET");
  const result = new Uint8Array(WRITE_PACKET_LENGTH);
  const view = new DataView(result.buffer);
  result[0] = 4;
  result[1] = 1;
  result[5] = PAGE_LENGTH;
  view.setUint16(7, crc16(payload), true);
  result[9] = CONFIG_LENGTH;
  view.setUint32(13, offset, true);
  result.set(payload, 17);
  return result;
}
export function buildReadRequest(offset: number): Uint8Array {
  const result = buildWritePage(offset, new Uint8Array(PAGE_LENGTH));
  result[1] = 2;
  return result;
}
export function parseConfigNotification(packet: Uint8Array): ConfigPage | null {
  if (packet[0] !== 4 || packet[1] !== 0 || packet[2] !== 2) return null;
  if (packet.length !== READ_RESPONSE_LENGTH)
    throw new ProtocolError("INVALID_PACKET");
  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  );
  if (
    packet[3] !== 0 ||
    view.getUint16(4, true) !== PAGE_LENGTH ||
    view.getUint32(8, true) !== CONFIG_LENGTH
  )
    throw new ProtocolError("INVALID_PACKET");
  const offset = view.getUint32(12, true);
  if (!isOffset(offset)) throw new ProtocolError("INVALID_PACKET");
  const payload = packet.slice(16);
  if (view.getUint16(6, true) !== crc16(payload))
    throw new ProtocolError("INVALID_CRC");
  return { offset, payload };
}
export function buildCommitPacket(): Uint8Array {
  return Uint8Array.of(
    4,
    6,
    0,
    0x5b,
    0,
    0,
    0,
    0xff,
    0xff,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  );
}
export function buildWriteSequence(config: Uint8Array): Uint8Array[] {
  if (config.length !== CONFIG_LENGTH)
    throw new ProtocolError("INCOMPLETE_CONFIG");
  return [
    ...PAGE_OFFSETS.map((o) =>
      buildWritePage(o, config.slice(o, o + PAGE_LENGTH)),
    ),
    buildCommitPacket(),
  ];
}
