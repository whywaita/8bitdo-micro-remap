import type { ConfigSnapshot, HidChord } from "../protocol/types";
import { BUTTONS, type ButtonId } from "../protocol/buttons";
import { AppError } from "../application/errors";
import type { MicroDatabase } from "./database";
import { profileSchema, type Profile } from "./schemas";
export function parseProfile(json: string): Profile {
  try {
    return profileSchema.parse(JSON.parse(json));
  } catch {
    throw new AppError("INVALID_PROFILE");
  }
}
export function serializeProfile(profile: Profile): string {
  try {
    const valid = profileSchema.parse(profile);
    const ordered = {
      schema: valid.schema,
      name: valid.name,
      createdAt: valid.createdAt,
      mappings: Object.fromEntries(
        BUTTONS.map((b) => [b.id, valid.mappings[b.id]]),
      ),
      ...(valid.disableSleep === undefined
        ? {}
        : { disableSleep: valid.disableSleep }),
    };
    return JSON.stringify(ordered, null, 2) + "\n";
  } catch {
    throw new AppError("INVALID_PROFILE");
  }
}
export function profileFromConfig(
  name: string,
  snapshot: ConfigSnapshot,
  date = new Date(),
): Profile {
  const mappings = {} as Record<ButtonId, HidChord>;
  for (const b of BUTTONS) {
    const value = snapshot.mappings[b.id];
    if (value.kind !== "chord") throw new AppError("INVALID_PROFILE");
    mappings[b.id] = structuredClone(value);
  }
  return parseProfile(
    JSON.stringify({
      schema: "8bitdo-micro-profile/v1",
      name,
      createdAt: date.toISOString(),
      mappings,
      ...(snapshot.disableSleep === null
        ? {}
        : { disableSleep: snapshot.disableSleep }),
    }),
  );
}
export class Profiles {
  constructor(private db: MicroDatabase) {}
  async save(profile: Profile): Promise<void> {
    const value = parseProfile(serializeProfile(profile));
    try {
      await this.db.profiles.put(value);
    } catch {
      throw new AppError("STORAGE_FAILED");
    }
  }
  async list(): Promise<Profile[]> {
    try {
      return (
        await this.db.profiles.orderBy("createdAt").reverse().toArray()
      ).map((value) => profileSchema.parse(value));
    } catch {
      throw new AppError("INVALID_PROFILE");
    }
  }
}
