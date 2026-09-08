import { AppError } from "../application/errors";
export class GattCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    const result = this.tail.then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  cancel(reason: unknown = new AppError("DISCONNECTED")): void {
    this.controller.abort(reason);
    this.controller = new AbortController();
  }
  async waitForIdle(): Promise<void> {
    await this.tail;
  }
}
