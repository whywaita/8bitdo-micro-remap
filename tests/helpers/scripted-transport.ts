import { AppError } from "../../src/application/errors";
import { NotificationStream } from "../../src/ble/notification-stream";
import type { MicroTransport } from "../../src/ble/micro-transport";
import { crc16 } from "../../src/protocol/crc16";
export class ScriptedTransport implements MicroTransport {
  connected = false;
  readonly writes: Uint8Array[] = [];
  payload = new Uint8Array(180);
  staged = this.payload.slice();
  readCount = 0;
  onWrite:
    | ((packet: Uint8Array, device: ScriptedTransport) => Promise<void> | void)
    | undefined;
  transform:
    | ((response: Uint8Array, device: ScriptedTransport) => Uint8Array[])
    | undefined;
  private listeners = new Set<() => void>();
  private streams = new Set<NotificationStream>();
  async connectFromUserGesture(): Promise<void> {
    this.connected = true;
    this.staged = this.payload.slice();
  }
  disconnect(): void {
    this.connected = false;
    for (const stream of this.streams) stream.close();
    this.streams.clear();
    for (const fn of this.listeners) fn();
  }
  isConnected(): boolean {
    return this.connected;
  }
  onDisconnected(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
  emit(packet: Uint8Array): void {
    for (const stream of this.streams) stream.push(packet);
  }
  async writeWithResponse(packet: Uint8Array): Promise<void> {
    if (!this.connected) throw new AppError("DISCONNECTED");
    this.writes.push(packet.slice());
    await this.onWrite?.(packet, this);
    if (!this.connected) throw new AppError("DISCONNECTED");
    if (packet[1] === 2) {
      const offset = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
      ).getUint32(13, true);
      if (offset === 0) this.readCount++;
      const result = new Uint8Array(61);
      result.set([4, 0, 2, 0, 45, 0]);
      const view = new DataView(result.buffer);
      result.set(this.payload.slice(offset, offset + 45), 16);
      view.setUint16(6, crc16(result.slice(16)), true);
      view.setUint32(8, 180, true);
      view.setUint32(12, offset, true);
      for (const response of this.transform?.(result, this) ?? [result])
        this.emit(response);
    }
    if (packet[1] === 1) {
      const offset = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
      ).getUint32(13, true);
      this.staged.set(packet.slice(17), offset);
    }
    if (packet[1] === 6) this.payload = this.staged.slice();
  }
}
