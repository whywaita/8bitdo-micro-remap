import { AppError } from "../application/errors";
import { abortable } from "../application/async";
import {
  MICRO_SERVICE_UUID,
  MICRO_CHARACTERISTIC_UUID,
} from "../protocol/constants";
import { GattCommandQueue } from "./command-queue";
import { NotificationStream } from "./notification-stream";
import type { MicroTransport } from "./micro-transport";
export class WebBluetoothTransport implements MicroTransport {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private queue = new GattCommandQueue();
  private streams = new Set<NotificationStream>();
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(
    private bluetooth: Bluetooth | undefined = globalThis.navigator?.bluetooth,
    private report: (phase: "connecting" | "subscribing") => void = () => {},
  ) {}
  async connectFromUserGesture(): Promise<void> {
    if (!this.bluetooth) throw new AppError("UNSUPPORTED_BROWSER");
    if (this.device) this.disconnect();
    const generation = ++this.generation;
    let device: BluetoothDevice;
    try {
      device = await this.bluetooth.requestDevice({
        filters: [{ name: "80EL" }, { namePrefix: "8BitDo" }],
        optionalServices: [MICRO_SERVICE_UUID],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        throw new AppError("CHOOSER_CANCELLED");
      throw new AppError("CONNECTION_FAILED");
    }
    if (generation !== this.generation) throw new AppError("DISCONNECTED");
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.onDisconnect);
    const check = () => {
      if (generation !== this.generation) throw new AppError("DISCONNECTED");
    };
    try {
      if (!device.gatt) throw new AppError("CONNECTION_FAILED");
      this.report("connecting");
      const server = await device.gatt.connect();
      check();
      const service = await this.queue.enqueue(async (signal) => {
        try {
          return await abortable(
            server.getPrimaryService(MICRO_SERVICE_UUID),
            signal,
          );
        } catch {
          signal.throwIfAborted();
          throw new AppError("SERVICE_NOT_FOUND");
        }
      });
      check();
      const characteristic = await this.queue.enqueue(async (signal) => {
        try {
          return await abortable(
            service.getCharacteristic(MICRO_CHARACTERISTIC_UUID),
            signal,
          );
        } catch {
          signal.throwIfAborted();
          throw new AppError("CHARACTERISTIC_NOT_FOUND");
        }
      });
      check();
      this.characteristic = characteristic;
      characteristic.addEventListener(
        "characteristicvaluechanged",
        this.onNotification,
      );
      this.report("subscribing");
      await this.queue.enqueue((signal) =>
        abortable(characteristic.startNotifications(), signal),
      );
      check();
    } catch (error) {
      if (generation === this.generation) this.disconnect();
      else device.gatt?.disconnect();
      throw error instanceof AppError
        ? error
        : new AppError("CONNECTION_FAILED");
    }
  }
  private onNotification = (): void => {
    const value = this.characteristic?.value;
    if (!value) return;
    const owned = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
    for (const stream of this.streams) stream.push(owned);
  };
  private cleanup(): void {
    this.generation++;
    this.queue.cancel();
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotification,
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnect,
    );
    this.characteristic = null;
    this.device = null;
    for (const stream of this.streams) stream.close();
    this.streams.clear();
  }
  private onDisconnect = (): void => {
    this.cleanup();
    for (const listener of this.listeners) listener();
  };
  disconnect(): void {
    const device = this.device;
    this.cleanup();
    device?.gatt?.disconnect();
    for (const listener of this.listeners) listener();
  }
  isConnected(): boolean {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }
  writeWithResponse(packet: Uint8Array): Promise<void> {
    const owned = packet.slice();
    return this.queue.enqueue(async (signal) => {
      const characteristic = this.characteristic;
      if (!this.isConnected() || !characteristic)
        throw new AppError("DISCONNECTED");
      await abortable(characteristic.writeValueWithResponse(owned), signal);
    });
  }
  notifications(): AsyncIterableIterator<Uint8Array> {
    const stream = new NotificationStream();
    this.streams.add(stream);
    const close = stream.return.bind(stream);
    stream.return = () => {
      this.streams.delete(stream);
      return close();
    };
    return stream;
  }
  onDisconnected(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
