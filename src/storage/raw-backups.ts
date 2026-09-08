import type {
  BackupRepository,
  BackupReason,
} from "../application/repositories";
import { AppError } from "../application/errors";
import type { MicroDatabase } from "./database";
import {
  bytesToBase64,
  base64ToBytes,
  rawBackupSchema,
  type RawBackup,
} from "./schemas";
export class RawBackups implements BackupRepository {
  constructor(
    private db: MicroDatabase,
    private clock: () => Date = () => new Date(),
  ) {}
  async save(raw: Uint8Array, reason: BackupReason): Promise<string> {
    try {
      const doc = rawBackupSchema.parse({
        schema: "8bitdo-micro-raw-backup/v1",
        id: crypto.randomUUID(),
        createdAt: this.clock().toISOString(),
        reason,
        payloadBase64: bytesToBase64(raw),
      });
      await this.db.transaction("rw", this.db.rawBackups, () =>
        this.db.rawBackups.add(doc),
      );
      return doc.id;
    } catch {
      throw new AppError("BACKUP_FAILED");
    }
  }
  async get(id: string): Promise<Uint8Array> {
    try {
      return base64ToBytes(
        rawBackupSchema.parse(await this.db.rawBackups.get(id)).payloadBase64,
      );
    } catch {
      throw new AppError("INVALID_BACKUP");
    }
  }
  async list(): Promise<RawBackup[]> {
    try {
      return (
        await this.db.rawBackups.orderBy("createdAt").reverse().toArray()
      ).map((value) => rawBackupSchema.parse(value));
    } catch {
      throw new AppError("INVALID_BACKUP");
    }
  }
  async inspect(): Promise<{ backups: RawBackup[]; invalidCount: number }> {
    try {
      const records = await this.db.rawBackups.toArray();
      const backups: RawBackup[] = [];
      let invalidCount = 0;
      for (const record of records) {
        const parsed = rawBackupSchema.safeParse(record);
        if (parsed.success) backups.push(parsed.data);
        else invalidCount++;
      }
      backups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return { backups, invalidCount };
    } catch {
      throw new AppError("STORAGE_FAILED");
    }
  }
  async remove(id: string): Promise<void> {
    try {
      await this.db.rawBackups.delete(id);
    } catch {
      throw new AppError("STORAGE_FAILED");
    }
  }
}
