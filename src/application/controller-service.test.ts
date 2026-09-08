import { crc16 } from "../protocol/crc16";
import { beforeEach, expect, it } from "vitest";
import { ControllerService } from "./controller-service";
import { ScriptedTransport } from "../../tests/helpers/scripted-transport";
import type { BackupRepository } from "./repositories";
import type { ConfigEdits } from "../protocol/types";
import { AppError } from "./errors";
const edit: ConfigEdits = {
  mappings: { a: { kind: "chord", modifiers: ["ctrl"], key: 26 } },
};
let device: ScriptedTransport;
let backups: Map<string, Uint8Array>;
let repo: BackupRepository;
let service: ControllerService;
beforeEach(() => {
  device = new ScriptedTransport();
  backups = new Map();
  repo = {
    async save(raw) {
      const id = String(backups.size + 1);
      backups.set(id, raw.slice());
      return id;
    },
    async get(id) {
      const raw = backups.get(id);
      if (!raw) throw new AppError("INVALID_BACKUP");
      return raw.slice();
    },
  };
  service = new ControllerService(device, repo, {
    readTimeout: 50,
    loadDelay: 0,
    saveDelay: 0,
    preparedTtl: 10000,
  });
});
const configWrites = () =>
  device.writes.filter((p) => p[1] === 1 || p[1] === 6);
it("backs up before every configuration write and verifies all bytes", async () => {
  await service.connect();
  const expectedOriginal = device.payload.slice();
  device.onWrite = (p) => {
    if (p[1] === 1) expect(backups.size).toBe(1);
  };
  const prepared = await service.prepareSave(edit);
  expect(configWrites()).toHaveLength(0);
  expect(prepared.changes).toHaveLength(1);
  await service.commitSave(prepared);
  expect(configWrites().map((p) => p[1])).toEqual([1, 1, 1, 1, 6]);
  expect(backups.get("1")).toEqual(expectedOriginal);
  expect(service.state.phase).toBe("ready");
  expect(service.state.verified).toBe(true);
});
it("backup failure prevents config writes", async () => {
  repo.save = async () => {
    throw Error("quota");
  };
  await service.connect();
  await expect(service.prepareSave(edit)).rejects.toThrow("BACKUP_FAILED");
  expect(configWrites()).toHaveLength(0);
});
it.each([0, 1, 2, 3])("page %i failure prevents commit", async (page) => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  let count = 0;
  device.onWrite = (p) => {
    if (p[1] === 1 && count++ === page) throw Error("write failed");
  };
  await expect(service.commitSave(prepared)).rejects.toThrow("WRITE_FAILED");
  expect(device.writes.some((p) => p[1] === 6)).toBe(false);
  expect(backups.size).toBe(1);
});
it("commit failure is not success", async () => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  device.onWrite = (p) => {
    if (p[1] === 6) throw Error("commit failed");
  };
  await expect(service.commitSave(prepared)).rejects.toThrow("COMMIT_FAILED");
  expect(service.state.verified).toBe(false);
});
it.each([12, 150])("detects readback mismatch at byte %i", async (index) => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  device.onWrite = (p) => {
    if (p[1] === 2 && device.readCount === 2) device.payload[index] = 123;
  };
  await expect(service.commitSave(prepared)).rejects.toThrow("VERIFY_FAILED");
  expect(service.state.verified).toBe(false);
});
it("initial incomplete reads never create a baseline", async () => {
  device.transform = (p) => (p[12] === 135 ? [] : [p]);
  await expect(service.connect()).rejects.toThrow("INCOMPLETE_CONFIG");
  expect(service.state.snapshot).toBeNull();
});
it("initial empty read times out", async () => {
  device.transform = () => [];
  await expect(service.connect()).rejects.toThrow("READ_TIMEOUT");
});
it("CRC failures prevent editing", async () => {
  device.transform = (p) => {
    p[6] = 0;
    return [p];
  };
  await expect(service.connect()).rejects.toThrow("INVALID_CRC");
  expect(service.state.snapshot).toBeNull();
});
it("conflicting duplicate pages reject the snapshot", async () => {
  device.transform = (p) => {
    if (p[12] !== 0) return [p];
    const duplicate = p.slice();
    duplicate[16] = 1;
    new DataView(duplicate.buffer).setUint16(
      6,
      crc16(duplicate.slice(16)),
      true,
    );
    return [p, duplicate];
  };
  await expect(service.connect()).rejects.toThrow("CONFLICTING_PAGE");
});
it.each(["drop", "crc"] as const)(
  "verification %s is a verification failure",
  async (mode) => {
    await service.connect();
    const prepared = await service.prepareSave(edit);
    device.transform = (p) => {
      if (mode === "drop") return [];
      p[6] = 0;
      return [p];
    };
    await expect(service.commitSave(prepared)).rejects.toThrow("VERIFY_FAILED");
  },
);
it("cancellation and token reuse cause no writes", async () => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  service.cancelPrepared();
  await expect(service.commitSave(prepared)).rejects.toThrow("STALE_OPERATION");
  expect(configWrites()).toHaveLength(0);
  const second = await service.prepareSave(edit);
  await service.commitSave(second);
  const count = configWrites().length;
  await expect(service.commitSave(second)).rejects.toThrow("STALE_OPERATION");
  expect(configWrites()).toHaveLength(count);
});
it("reconnection invalidates prepared tokens", async () => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  service.disconnect();
  await service.connect();
  await expect(service.commitSave(prepared)).rejects.toThrow("STALE_OPERATION");
});
it("rejects simultaneous saves", async () => {
  await service.connect();
  const first = service.prepareSave(edit);
  await expect(service.prepareSave(edit)).rejects.toThrow("STALE_OPERATION");
  await first;
});
it("requires review when device changed since displayed snapshot", async () => {
  await service.connect();
  device.payload[150] = 4;
  await expect(service.prepareSave(edit)).rejects.toThrow("DEVICE_CHANGED");
  expect(configWrites()).toHaveLength(0);
});
it("caller cannot mutate the internal baseline or prepared bytes", async () => {
  await service.connect();
  service.state.snapshot!.raw.fill(99);
  const prepared = await service.prepareSave(edit);
  await service.commitSave(prepared);
  expect(device.payload[150]).toBe(0);
});
it.each([0, 1, 2, 3, 4, 5, 6, 7])(
  "disconnect during read packet %i stops operation",
  async (index) => {
    let count = 0;
    device.onWrite = () => {
      if (count++ === index) device.disconnect();
    };
    await expect(service.connect()).rejects.toThrow("DISCONNECTED");
    expect(service.state.phase).toBe("disconnected");
  },
);
it.each([1, 6, 2])(
  "disconnect during save phase command %i stops operation",
  async (command) => {
    await service.connect();
    const prepared = await service.prepareSave(edit);
    device.onWrite = (p) => {
      if (p[1] === command) device.disconnect();
    };
    await expect(service.commitSave(prepared)).rejects.toThrow("DISCONNECTED");
    expect(service.state.phase).toBe("disconnected");
  },
);
it("restore keeps current unknown bytes and skips unsupported backup fields", async () => {
  device.payload[150] = 42;
  device.payload[3] = 8;
  const raw = new Uint8Array(180).fill(0);
  raw[12] = 40;
  raw[60] = 255;
  raw[150] = 99;
  raw[3] = 1;
  backups.set("old", raw);
  await service.connect();
  const prepared = await service.prepareRestore("old");
  expect(prepared.skipped).toContain("star");
  expect(prepared.skipped).toContain("disableSleep");
  expect(configWrites()).toHaveLength(0);
  await service.commitSave(prepared);
  expect(device.payload[12]).toBe(40);
  expect(device.payload[60]).toBe(0);
  expect(device.payload[150]).toBe(42);
  expect(device.payload[3]).toBe(8);
  expect(backups.size).toBe(2);
});
it("expired preparation is rejected without writes", async () => {
  let now = 0;
  service = new ControllerService(
    device,
    repo,
    { readTimeout: 100, loadDelay: 0, saveDelay: 0, preparedTtl: 10 },
    () => now,
  );
  await service.connect();
  const prepared = await service.prepareSave(edit);
  now = 11;
  await expect(service.commitSave(prepared)).rejects.toThrow("STALE_OPERATION");
  expect(configWrites()).toHaveLength(0);
});
it("missing persisted backup rejects confirmed save", async () => {
  await service.connect();
  const prepared = await service.prepareSave(edit);
  backups.clear();
  await expect(service.commitSave(prepared)).rejects.toThrow("BACKUP_FAILED");
  expect(configWrites()).toHaveLength(0);
});
it("error acknowledgement clears the displayed error", async () => {
  await service.connect();
  device.payload[150] = 1;
  await expect(service.prepareSave(edit)).rejects.toThrow("DEVICE_CHANGED");
  service.dismissError();
  expect(service.state.error).toBeNull();
});
it("disconnect while backup is pending invalidates preparation", async () => {
  await service.connect();
  let resolve!: (id: string) => void;
  repo.save = () => new Promise((r) => (resolve = r));
  const pending = service.prepareSave(edit);
  const rejected = expect(pending).rejects.toThrow("DISCONNECTED");
  await new Promise((r) => setTimeout(r, 0));
  service.disconnect();
  resolve("late");
  await rejected;
  expect(configWrites()).toHaveLength(0);
});
it("restore cancellation and backup failure prevent writes", async () => {
  backups.set("old", new Uint8Array(180));
  await service.connect();
  const p = await service.prepareRestore("old");
  service.cancelPrepared();
  await expect(service.commitSave(p)).rejects.toThrow("STALE_OPERATION");
  repo.save = async () => {
    throw Error("quota");
  };
  await expect(service.prepareRestore("old")).rejects.toThrow("BACKUP_FAILED");
  expect(configWrites()).toHaveLength(0);
});
it.each([1, 6])(
  "times out an unacknowledged write command %i",
  async (command) => {
    await service.connect();
    const prepared = await service.prepareSave(edit);
    device.onWrite = (p) =>
      p[1] === command ? new Promise<void>(() => {}) : undefined;
    await expect(service.commitSave(prepared)).rejects.toThrow(
      command === 1 ? "WRITE_FAILED" : "COMMIT_FAILED",
    );
    expect(device.connected).toBe(false);
  },
);
