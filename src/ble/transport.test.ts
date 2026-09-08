import { expect, it, vi } from "vitest";
import { GattCommandQueue } from "./command-queue";
import { NotificationStream } from "./notification-stream";
it("executes FIFO and continues after rejection without overlap", async () => {
  const queue = new GattCommandQueue();
  const events: number[] = [];
  let release!: () => void;
  const first = queue.enqueue(async () => {
    events.push(1);
    await new Promise<void>((r) => (release = r));
    events.push(2);
    throw Error("failed");
  });
  const caught = expect(first).rejects.toThrow("failed");
  const second = queue.enqueue(async () => events.push(3));
  await vi.waitFor(() => expect(events).toEqual([1]));
  release();
  await caught;
  await second;
  await queue.waitForIdle();
  expect(events).toEqual([1, 2, 3]);
});
it("cancels queued and active operations, never starts queued work", async () => {
  const queue = new GattCommandQueue();
  const work = vi.fn();
  const first = queue.enqueue(
    (signal) =>
      new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  );
  const firstCheck = expect(first).rejects.toThrow("DISCONNECTED");
  const second = queue.enqueue(work);
  const secondCheck = expect(second).rejects.toThrow("DISCONNECTED");
  await Promise.resolve();
  queue.cancel();
  await Promise.all([firstCheck, secondCheck]);
  await queue.waitForIdle();
  expect(work).not.toHaveBeenCalled();
});
it("copies notifications and discards buffered packets on close", async () => {
  const stream = new NotificationStream();
  const raw = Uint8Array.of(1);
  stream.push(raw);
  raw[0] = 9;
  expect((await stream.next()).value).toEqual(Uint8Array.of(1));
  const next = stream.next();
  stream.push(Uint8Array.of(2));
  expect((await next).value).toEqual(Uint8Array.of(2));
  stream.push(Uint8Array.of(3));
  stream.close();
  expect((await stream.next()).done).toBe(true);
});
it("closing stream releases all waiters", async () => {
  const stream = new NotificationStream();
  const pending = stream.next();
  stream.close();
  expect((await pending).done).toBe(true);
});
