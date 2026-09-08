import { createRuntime } from "../../src/application/runtime";
import { MicroDatabase } from "../../src/storage/database";
import { ScriptedTransport } from "./scripted-transport";
import { bytesToBase64, base64ToBytes } from "../../src/storage/schemas";
declare global {
  interface Window {
    __microTests?: {
      writes: number[];
      backedUpBeforeWrite: boolean;
      unknownByte: number;
    };
  }
}
export function createBrowserTestRuntime() {
  const device = new ScriptedTransport();
  const saved = sessionStorage.getItem("fake-device");
  if (saved) device.payload = base64ToBytes(saved).slice();
  else device.payload[150] = 42;
  const db = new MicroDatabase();
  const scenario = new URLSearchParams(location.search).get("scenario");
  const telemetry = {
    writes: [] as number[],
    backedUpBeforeWrite: true,
    unknownByte: device.payload[150]!,
  };
  window.__microTests = telemetry;
  let page = 0;
  device.onWrite = async (packet) => {
    if (packet[1] === 1 || packet[1] === 6) {
      telemetry.writes.push(packet[1]);
      if ((await db.rawBackups.count()) === 0)
        telemetry.backedUpBeforeWrite = false;
    }
    if (packet[1] === 1 && ++page === 3 && scenario === "write-failure")
      throw Error("scripted write failure");
    if (packet[1] === 2 && telemetry.writes.includes(6)) {
      if (scenario === "disconnect") device.disconnect();
      if (scenario === "mismatch") device.payload[150] = 99;
    }
  };
  device.transform = (packet) => {
    if (device.readCount >= 3 && scenario === "crc-failure")
      packet[6] = packet[6]! ^ 1;
    sessionStorage.setItem("fake-device", bytesToBase64(device.payload));
    telemetry.unknownByte = device.payload[150]!;
    return [packet];
  };
  return createRuntime(() => device, db, scenario !== "unsupported", {
    readTimeout: 200,
    loadDelay: 0,
    saveDelay: 0,
    preparedTtl: 60000,
  });
}
