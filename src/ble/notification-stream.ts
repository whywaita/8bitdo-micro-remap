export class NotificationStream implements AsyncIterableIterator<Uint8Array> {
  private buffer: Uint8Array[] = [];
  private waiters: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private ended = false;
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return this;
  }
  push(packet: Uint8Array): void {
    if (this.ended) return;
    const value = packet.slice();
    const resolve = this.waiters.shift();
    if (resolve) resolve({ value, done: false });
    else this.buffer.push(value);
  }
  next(): Promise<IteratorResult<Uint8Array>> {
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    const value = this.buffer.shift();
    if (value) return Promise.resolve({ value, done: false });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  close(): void {
    this.ended = true;
    this.buffer = [];
    for (const resolve of this.waiters.splice(0))
      resolve({ value: undefined, done: true });
  }
  return(): Promise<IteratorResult<Uint8Array>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }
}
