import { describe, it, expect } from "vitest";
import { crc16 } from "./crc16";
import { BUTTONS } from "./buttons";
import { encodeChord, decodeChord, formatChord } from "./hid-codec";
import {
  buildReadRequest,
  buildWritePage,
  buildCommitPacket,
  buildWriteSequence,
  parseConfigNotification,
} from "./packets";
import { parseConfig, applyConfigEdits, assembleConfigPages } from "./config";
import { loadPreamble } from "./initialization";
const hex = (s: string) =>
  Uint8Array.from(
    s
      .trim()
      .split(/\s+/)
      .map((v) => parseInt(v, 16)),
  );
const response = hex(
  "04 00 02 00 2d 00 9d 95 b4 00 00 00 00 00 00 00 8c b8 00 00 11 09 20 20 11 09 20 20 28 00 00 00 2a 00 00 00 e0 1a 00 00 e0 e1 17 00 e0 00 00 00 e2 00 00 00 e0 06 00 00 e0 19 00 00 00",
);
describe("CRC and documented captured response", () => {
  it("matches independent known vectors", () => {
    expect(crc16(new Uint8Array())).toBe(0xffff);
    expect(crc16(new Uint8Array(45))).toBe(0xcf30);
    expect(crc16(response.slice(16))).toBe(0x959d);
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x4b37);
  });
  it("parses an owned payload, including nonzero DataView byteOffset", () => {
    const padded = new Uint8Array(70);
    padded.set(response, 3);
    const page = parseConfigNotification(padded.subarray(3, 64))!;
    expect(page.offset).toBe(0);
    expect(page.payload).toEqual(response.slice(16));
    page.payload.fill(0);
    expect(padded[19]).toBe(0x8c);
  });
  it.each([0, 1, 2])("ignores unrelated prefix at %i", (i) => {
    const p = response.slice();
    p[i] = 9;
    expect(parseConfigNotification(p)).toBeNull();
  });
  it("ignores empty notifications", () =>
    expect(parseConfigNotification(new Uint8Array())).toBeNull());
  it.each([response.slice(0, 60), new Uint8Array([...response, 0])])(
    "rejects related wrong length",
    (p) => expect(() => parseConfigNotification(p)).toThrow("INVALID_PACKET"),
  );
  it.each([3, 4, 5, 8, 9, 10, 11])("rejects invalid header byte %i", (i) => {
    const p = response.slice();
    p[i] = 7;
    expect(() => parseConfigNotification(p)).toThrow("INVALID_PACKET");
  });
  it("rejects invalid offsets and CRC", () => {
    const p = response.slice();
    p[12] = 1;
    expect(() => parseConfigNotification(p)).toThrow("INVALID_PACKET");
    p[12] = 0;
    p[16] = 0;
    expect(() => parseConfigNotification(p)).toThrow("INVALID_CRC");
  });
});
describe("packet builders", () => {
  it.each([0, 45, 90, 135])("builds complete read request for %i", (offset) => {
    expect(buildReadRequest(offset)).toEqual(
      new Uint8Array([
        ...hex("04 02 00 00 00 2d 00 30 cf b4 00 00 00"),
        offset,
        0,
        0,
        0,
        ...new Uint8Array(45),
      ]),
    );
  });
  it("builds complete write and commit golden packets", () => {
    expect(buildWritePage(0, response.slice(16))).toEqual(
      new Uint8Array([
        ...hex("04 01 00 00 00 2d 00 9d 95 b4 00 00 00 00 00 00 00"),
        ...response.slice(16),
      ]),
    );
    expect(buildCommitPacket()).toEqual(
      hex("04 06 00 5b 00 00 00 ff ff 00 00 00 00 00 00 00 00"),
    );
    expect(buildWriteSequence(new Uint8Array(180))).toHaveLength(5);
  });
  it.each([-1, 1, 180, NaN])("rejects invalid offset %i", (offset) => {
    expect(() => buildReadRequest(offset)).toThrow("INVALID_PACKET");
    expect(() => buildWritePage(offset, new Uint8Array(45))).toThrow(
      "INVALID_PACKET",
    );
  });
  it.each([0, 44, 46])("rejects wrong page length %i", (n) =>
    expect(() => buildWritePage(0, new Uint8Array(n))).toThrow(
      "INVALID_PACKET",
    ),
  );
  it("rejects wrong configuration length", () =>
    expect(() => buildWriteSequence(new Uint8Array(179))).toThrow(
      "INCOMPLETE_CONFIG",
    ));
  it("returns fresh initialization buffers with literal provenance", () => {
    const p = loadPreamble();
    expect(p.map((x) => Array.from(x))).toEqual(
      [
        "04 5a 00 00 00 01 00 bf 40 01 00 00 00 00 00 00 00 00",
        "04 0b 00 00 00 04 00 00 24 04 00 00 00 40 70 01 01 00 00 00 00",
        "04 11 00 01 00 00 00 ff ff 00 00 00 00 00 00 00 00",
        "04 11 00 00 00 00 00 ff ff 00 00 00 00 00 00 00 00",
      ].map((s) => Array.from(hex(s))),
    );
    p[0]!.fill(0);
    expect(loadPreamble()[0]![0]).toBe(4);
  });
});
describe("HID and configuration preservation", () => {
  it("has precisely the documented slots", () => {
    expect(BUTTONS.map((x) => x.slot)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    for (const prop of ["id", "slot", "offset"] as const)
      expect(new Set(BUTTONS.map((b) => b[prop])).size).toBe(16);
  });
  it("encodes canonical modifiers and supported chords", () => {
    expect(
      encodeChord({
        kind: "chord",
        modifiers: ["shift", "ctrl", "alt"],
        key: 23,
      }),
    ).toEqual(hex("e0 e2 e1 17"));
    expect(encodeChord({ kind: "chord", modifiers: [], key: null })).toEqual(
      new Uint8Array(4),
    );
    expect(formatChord(decodeChord(hex("e0 1a 00 00")))).toBe("Ctrl + W");
  });
  it.each([
    hex("ff 00 00 00"),
    hex("04 05 00 00"),
    hex("e0 e0 00 00"),
    hex("e4 04 00 00"),
  ])("preserves unsupported mappings", (raw) => {
    const decoded = decodeChord(raw);
    expect(decoded.kind).toBe("unknown");
    if (decoded.kind === "unknown") {
      expect(decoded.raw).toEqual(raw);
      decoded.raw.fill(0);
      expect(raw.some((x) => x !== 0)).toBe(true);
    }
  });
  it("rejects invalid chords", () => {
    expect(() =>
      encodeChord({ kind: "chord", modifiers: ["ctrl", "ctrl"], key: 4 }),
    ).toThrow("INVALID_MAPPING");
    expect(() =>
      encodeChord({
        kind: "chord",
        modifiers: ["ctrl", "alt", "shift", "meta"],
        key: 4,
      }),
    ).toThrow("INVALID_MAPPING");
    expect(() =>
      encodeChord({ kind: "chord", modifiers: [], key: 255 }),
    ).toThrow("INVALID_MAPPING");
    expect(() => decodeChord(new Uint8Array(3))).toThrow("INVALID_MAPPING");
  });
  it("changes only requested bytes over many baselines", () => {
    for (let seed = 0; seed < 32; seed++) {
      const raw = Uint8Array.from(
        { length: 180 },
        (_, i) => (i * 73 + seed * 19) % 256,
      );
      const before = raw.slice();
      const snapshot = parseConfig(raw);
      const result = applyConfigEdits(snapshot, {
        mappings: { a: { kind: "chord", modifiers: [], key: 40 } },
      });
      for (let i = 0; i < 180; i++)
        if (i < 12 || i >= 16) expect(result[i]).toBe(before[i]);
      expect(raw).toEqual(before);
      expect(snapshot.raw).toEqual(before);
    }
  });
  it("preserves unknown sleep and rejects normalization", () => {
    const raw = new Uint8Array(180);
    raw[3] = 8;
    const snapshot = parseConfig(raw);
    expect(snapshot.disableSleep).toBeNull();
    expect(applyConfigEdits(snapshot, { mappings: {} })[3]).toBe(8);
    expect(() =>
      applyConfigEdits(snapshot, { mappings: {}, disableSleep: true }),
    ).toThrow("INVALID_MAPPING");
    raw[3] = 0;
    expect(
      applyConfigEdits(parseConfig(raw), {
        mappings: {},
        disableSleep: true,
      })[3],
    ).toBe(1);
  });
  it("assembles reordered owned pages and handles duplicates", () => {
    const pages = ([135, 90, 45, 0] as const).map((offset) => ({
      offset,
      payload: new Uint8Array(45).fill(offset),
    }));
    const result = assembleConfigPages([...pages, pages[0]!]);
    expect(result[135]).toBe(135);
    result.fill(0);
    expect(pages[0]!.payload[0]).toBe(135);
    expect(() => assembleConfigPages(pages.slice(1))).toThrow(
      "INCOMPLETE_CONFIG",
    );
    expect(() =>
      assembleConfigPages([
        ...pages,
        { offset: 0, payload: new Uint8Array(45).fill(1) },
      ]),
    ).toThrow("CONFLICTING_PAGE");
  });
});
it("matches additional public observed nonzero page CRCs", () => {
  // Protocol byte observations only, not source implementation:
  // https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper/blob/main/tests/MicroKeyStudio.Protocol.Tests/MicroCrc16Tests.cs
  expect(
    crc16(
      hex(
        "ff 6d 00 00 11 09 20 20 11 09 20 20 0a 00 00 00 0d 00 00 00 0b 00 00 00 0c 00 00 00 59 00 00 00 10 00 00 00 0f 00 00 00 15 00 00 00 00",
      ),
    ),
  ).toBe(0xd33a);
  expect(
    crc16(
      hex(
        "00 00 00 00 00 00 00 11 00 00 00 12 00 00 00 00 00 00 00 16 00 00 00 09 00 00 00 51 00 00 00 07 00 00 00 4f 00 00 00 00 00 00 00 00 00",
      ),
    ),
  ).toBe(0x8e09);
});
