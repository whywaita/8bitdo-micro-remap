import { expect, it, vi } from "vitest";
import { WebBluetoothTransport } from "./web-bluetooth-transport";
import {
  MICRO_CHARACTERISTIC_UUID,
  MICRO_SERVICE_UUID,
} from "../protocol/constants";
function fixture() {
  const characteristic = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => characteristic),
    writeValueWithResponse: vi.fn(async () => undefined),
  });
  const service = { getCharacteristic: vi.fn(async () => characteristic) };
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      gatt.connected = true;
      return gatt;
    }),
    getPrimaryService: vi.fn(async () => service),
    disconnect: vi.fn(() => {
      gatt.connected = false;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    }),
  };
  const device = Object.assign(new EventTarget(), { gatt });
  const bluetooth = { requestDevice: vi.fn(async () => device) };
  const transport = new WebBluetoothTransport(
    bluetooth as unknown as Bluetooth,
  );
  return { transport, bluetooth, device, gatt, service, characteristic };
}
it("requests filtered chooser synchronously and exact UUIDs, subscribes before writes", async () => {
  const f = fixture();
  const connecting = f.transport.connectFromUserGesture();
  expect(f.bluetooth.requestDevice).toHaveBeenCalledWith({
    filters: [{ name: "80EL" }, { namePrefix: "8BitDo" }],
    optionalServices: [MICRO_SERVICE_UUID],
  });
  await connecting;
  expect(f.gatt.getPrimaryService).toHaveBeenCalledWith(MICRO_SERVICE_UUID);
  expect(f.service.getCharacteristic).toHaveBeenCalledWith(
    MICRO_CHARACTERISTIC_UUID,
  );
  expect(f.characteristic.startNotifications).toHaveBeenCalledOnce();
  await f.transport.writeWithResponse(Uint8Array.of(4));
  expect(f.characteristic.writeValueWithResponse).toHaveBeenCalledOnce();
  f.transport.disconnect();
});
it("copies only DataView bytes and removes listener after disconnect", async () => {
  const f = fixture();
  await f.transport.connectFromUserGesture();
  const stream = f.transport.notifications();
  const raw = Uint8Array.of(9, 1, 2, 8);
  f.characteristic.value = new DataView(raw.buffer, 1, 2);
  f.characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
  raw.fill(0);
  expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2));
  const listener = vi.fn();
  f.transport.onDisconnected(listener);
  f.transport.disconnect();
  expect(listener).toHaveBeenCalledOnce();
  expect((await stream.next()).done).toBe(true);
  await expect(f.transport.writeWithResponse(Uint8Array.of(4))).rejects.toThrow(
    "DISCONNECTED",
  );
});
it("reacquires handles on reconnect", async () => {
  const f = fixture();
  await f.transport.connectFromUserGesture();
  f.transport.disconnect();
  await f.transport.connectFromUserGesture();
  expect(f.service.getCharacteristic).toHaveBeenCalledTimes(2);
  f.transport.disconnect();
});
it("maps chooser cancellation without leaking browser details", async () => {
  const bluetooth = {
    requestDevice: vi.fn(async () => {
      throw new DOMException("private device", "NotFoundError");
    }),
  };
  const transport = new WebBluetoothTransport(
    bluetooth as unknown as Bluetooth,
  );
  await expect(transport.connectFromUserGesture()).rejects.toThrow(
    "CHOOSER_CANCELLED",
  );
});
it("late chooser completion after cancellation cannot connect", async () => {
  const f = fixture();
  let resolve!: (value: typeof f.device) => void;
  f.bluetooth.requestDevice.mockImplementation(
    () => new Promise((r) => (resolve = r)),
  );
  const promise = f.transport.connectFromUserGesture();
  const rejected = expect(promise).rejects.toThrow("DISCONNECTED");
  f.transport.disconnect();
  resolve(f.device);
  await rejected;
  expect(f.gatt.connect).not.toHaveBeenCalled();
});
it("reports missing services and cleans up connection", async () => {
  const f = fixture();
  f.gatt.getPrimaryService.mockRejectedValue(new Error("private"));
  await expect(f.transport.connectFromUserGesture()).rejects.toThrow(
    "SERVICE_NOT_FOUND",
  );
  expect(f.gatt.connected).toBe(false);
});
