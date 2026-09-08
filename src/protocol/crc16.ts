// Independently implemented from the protocol parameters in docs/design.md §7.3.
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);
  }
  return crc & 0xffff;
}
