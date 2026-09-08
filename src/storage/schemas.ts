import { z } from "zod";
import { BUTTONS } from "../protocol/buttons";
import { encodeChord } from "../protocol/hid-codec";
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function base64ToBytes(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw Error("INVALID_BASE64");
  const result = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytesToBase64(result) !== value) throw Error("INVALID_BASE64");
  return result;
}
export const rawBackupSchema = z.strictObject({
  schema: z.literal("8bitdo-micro-raw-backup/v1"),
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  reason: z.enum(["pre-save", "pre-restore", "manual"]),
  payloadBase64: z.string().refine((value) => {
    try {
      return base64ToBytes(value).length === 180;
    } catch {
      return false;
    }
  }),
});
export type RawBackup = z.infer<typeof rawBackupSchema>;
const chordSchema = z
  .strictObject({
    kind: z.literal("chord"),
    modifiers: z.array(z.enum(["ctrl", "alt", "shift", "meta"])),
    key: z.number().int().nullable(),
  })
  .refine((value) => {
    try {
      encodeChord(value);
      return true;
    } catch {
      return false;
    }
  });
const mappingShape = Object.fromEntries(
  BUTTONS.map((b) => [b.id, chordSchema]),
) as Record<(typeof BUTTONS)[number]["id"], typeof chordSchema>;
export const profileSchema = z.strictObject({
  schema: z.literal("8bitdo-micro-profile/v1"),
  name: z.string().trim().min(1).max(80),
  createdAt: z.iso.datetime(),
  mappings: z.strictObject(mappingShape),
  disableSleep: z.boolean().optional(),
});
export type Profile = z.infer<typeof profileSchema>;
