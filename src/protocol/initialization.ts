// Verbatim observations, docs/design.md §7.8. Unknown fields are not interpreted.
const OBSERVED_LOAD_PREAMBLE_1 = [
  4, 0x5a, 0, 0, 0, 1, 0, 0xbf, 0x40, 1, 0, 0, 0, 0, 0, 0, 0, 0,
];
const OBSERVED_LOAD_PREAMBLE_2 = [
  4, 0x0b, 0, 0, 0, 4, 0, 0, 0x24, 4, 0, 0, 0, 0x40, 0x70, 1, 1, 0, 0, 0, 0,
];
const OBSERVED_LOAD_PREAMBLE_3 = [
  4, 0x11, 0, 1, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0,
];
const OBSERVED_LOAD_PREAMBLE_4 = [
  4, 0x11, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0,
];
export function loadPreamble(): Uint8Array[] {
  return [
    OBSERVED_LOAD_PREAMBLE_1,
    OBSERVED_LOAD_PREAMBLE_2,
    OBSERVED_LOAD_PREAMBLE_3,
    OBSERVED_LOAD_PREAMBLE_4,
  ].map((p) => Uint8Array.from(p));
}
