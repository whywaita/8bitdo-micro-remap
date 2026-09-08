export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Bounds an operation even when the platform promise never settles. */
export async function withDeadline<T>(
  promise: Promise<T>,
  milliseconds: number,
  error: Error,
  signal: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  signal.addEventListener("abort", relay, { once: true });
  if (signal.aborted) relay();
  const timer = setTimeout(() => controller.abort(error), milliseconds);
  try {
    return await abortable(promise, controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", relay);
  }
}
