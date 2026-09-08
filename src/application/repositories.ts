export type BackupReason = "pre-save" | "pre-restore" | "manual";
export interface BackupRepository {
  save(raw: Uint8Array, reason: BackupReason): Promise<string>;
  get(id: string): Promise<Uint8Array>;
}
