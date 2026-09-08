import Dexie, { type EntityTable } from "dexie";
import type { RawBackup, Profile } from "./schemas";
export class MicroDatabase extends Dexie {
  rawBackups!: EntityTable<RawBackup, "id">;
  profiles!: EntityTable<Profile, "name">;
  constructor(name = "8bitdo-micro-remap") {
    super(name);
    this.version(1).stores({
      rawBackups: "id,createdAt",
      profiles: "name,createdAt",
    });
  }
}
