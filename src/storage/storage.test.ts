import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MicroDatabase } from "./database";
import { RawBackups } from "./raw-backups";
import {
  Profiles,
  parseProfile,
  serializeProfile,
  profileFromConfig,
} from "./profiles";
import { bytesToBase64, base64ToBytes, rawBackupSchema } from "./schemas";
import { parseConfig } from "../protocol/config";
let db: MicroDatabase;
let backups: RawBackups;
let profiles: Profiles;
beforeEach(() => {
  db = new MicroDatabase(`test-${crypto.randomUUID()}`);
  backups = new RawBackups(db);
  profiles = new Profiles(db);
});
afterEach(async () => {
  await db.delete();
});
it("roundtrips bytes and rejects noncanonical or corrupt Base64", () => {
  const raw = Uint8Array.from({ length: 180 }, (_, i) => i);
  expect(base64ToBytes(bytesToBase64(raw))).toEqual(raw);
  for (const s of ["%%%%", "A", "AA=A", "AB==", " AA=="])
    expect(() => base64ToBytes(s)).toThrow();
});
it("persists backups and validates exact fields", async () => {
  const raw = new Uint8Array(180);
  raw[150] = 42;
  const id = await backups.save(raw, "pre-save");
  raw.fill(9);
  expect((await backups.get(id))[150]).toBe(42);
  const list = await backups.list();
  expect(list).toHaveLength(1);
  expect(Object.keys(list[0]!).sort()).toEqual(
    ["schema", "id", "createdAt", "reason", "payloadBase64"].sort(),
  );
  expect(() =>
    rawBackupSchema.parse({ ...list[0], deviceName: "private" }),
  ).toThrow();
  expect(() =>
    rawBackupSchema.parse({ ...list[0], createdAt: "invalid" }),
  ).toThrow();
  expect(() =>
    rawBackupSchema.parse({
      ...list[0],
      payloadBase64: bytesToBase64(new Uint8Array(179)),
    }),
  ).toThrow();
  await backups.remove(id);
  await expect(backups.get(id)).rejects.toThrow("INVALID_BACKUP");
});
it("orders by timestamp and rejects corrupted stored data", async () => {
  const old = new RawBackups(db, () => new Date("2025-01-01T00:00:00Z"));
  const recent = new RawBackups(db, () => new Date("2026-01-01T00:00:00Z"));
  const first = await old.save(new Uint8Array(180), "manual");
  const second = await recent.save(new Uint8Array(180), "manual");
  expect((await backups.list()).map((x) => x.id)).toEqual([second, first]);
  await db.rawBackups.update(first, { payloadBase64: "broken" });
  await expect(backups.get(first)).rejects.toThrow("INVALID_BACKUP");
});
it("aborted transaction leaves no recovery point", async () => {
  await expect(
    db.transaction("rw", db.rawBackups, async () => {
      await backups.save(new Uint8Array(180), "manual");
      throw Error("abort");
    }),
  ).rejects.toThrow("abort");
  expect(await db.rawBackups.count()).toBe(0);
});
it("exports deterministic strictly validated profiles without unknown data", async () => {
  const profile = profileFromConfig(
    "Work",
    parseConfig(new Uint8Array(180)),
    new Date("2026-09-09T00:00:00Z"),
  );
  const json = serializeProfile(profile);
  expect(parseProfile(json)).toEqual(profile);
  expect(json).not.toContain("payloadBase64");
  expect(json).not.toContain("raw");
  await profiles.save(profile);
  expect(await profiles.list()).toEqual([profile]);
  expect(() =>
    parseProfile(JSON.stringify({ ...profile, address: "private" })),
  ).toThrow("INVALID_PROFILE");
  expect(() =>
    parseProfile(JSON.stringify({ ...profile, mappings: {} })),
  ).toThrow("INVALID_PROFILE");
  expect(() => parseProfile(JSON.stringify({ ...profile, name: "" }))).toThrow(
    "INVALID_PROFILE",
  );
  expect(() =>
    parseProfile(
      JSON.stringify({
        ...profile,
        mappings: {
          ...profile.mappings,
          a: { kind: "chord", modifiers: ["ctrl", "ctrl"], key: 4 },
        },
      }),
    ),
  ).toThrow("INVALID_PROFILE");
});
it("unknown mappings block profile export but unknown sleep is omitted", () => {
  const raw = new Uint8Array(180);
  raw[3] = 255;
  const profile = profileFromConfig("Test", parseConfig(raw));
  expect(profile.disableSleep).toBeUndefined();
  raw[12] = 255;
  expect(() => profileFromConfig("Test", parseConfig(raw))).toThrow(
    "INVALID_PROFILE",
  );
});
it("keeps valid recovery points available when another backup is corrupt", async () => {
  const valid = await backups.save(new Uint8Array(180), "manual");
  const corrupt = await backups.save(new Uint8Array(180), "manual");
  await db.rawBackups.update(corrupt, { payloadBase64: "invalid" });
  const inventory = await backups.inspect();
  expect(inventory.backups.map((b) => b.id)).toEqual([valid]);
  expect(inventory.invalidCount).toBe(1);
  expect(await db.rawBackups.count()).toBe(2);
});
