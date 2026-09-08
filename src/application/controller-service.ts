import type { MicroTransport } from "../ble/micro-transport";
import { PAGE_OFFSETS, PAGE_LENGTH } from "../protocol/constants";
import { BUTTONS } from "../protocol/buttons";
import {
  assembleConfigPages,
  parseConfig,
  applyConfigEdits,
  equalBytes,
} from "../protocol/config";
import {
  buildReadRequest,
  buildWritePage,
  buildCommitPacket,
  parseConfigNotification,
  type ConfigPage,
} from "../protocol/packets";
import { loadPreamble } from "../protocol/initialization";
import { formatChord } from "../protocol/hid-codec";
import type { ConfigEdits, ConfigSnapshot } from "../protocol/types";
import { AppError, errorCode } from "./errors";
import type { BackupRepository, BackupReason } from "./repositories";
import type { OperationState, Phase } from "./operation-state";
import { abortable, delay, withDeadline } from "./async";
export interface TimingPolicy {
  readTimeout: number;
  loadDelay: number;
  saveDelay: number;
  preparedTtl: number;
}
export const DEFAULT_TIMING: TimingPolicy = {
  readTimeout: 8000,
  loadDelay: 180,
  saveDelay: 120,
  preparedTtl: 60000,
};
export interface Change {
  label: string;
  before: string;
  after: string;
}
export interface PreparedSave {
  readonly changes: ReadonlyArray<Change>;
  readonly skipped: ReadonlyArray<string>;
  readonly reason: BackupReason;
  readonly backupId: string;
}
interface Pending {
  token: PreparedSave;
  expected: Uint8Array;
  baseline: Uint8Array;
  generation: number;
  createdAt: number;
}
export class ControllerService {
  private current: OperationState = {
    phase: "disconnected",
    snapshot: null,
    error: null,
    verified: false,
    progress: 0,
    notificationLength: null,
    log: [],
  };
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private pending: Pending | null = null;
  private generation = 0;
  private unsubscribe: () => void;
  constructor(
    private transport: MicroTransport,
    private backups: BackupRepository,
    private timing: TimingPolicy = DEFAULT_TIMING,
    private clock: () => number = Date.now,
  ) {
    this.unsubscribe = transport.onDisconnected(() => {
      this.generation++;
      this.pending = null;
      this.active?.abort(new AppError("DISCONNECTED"));
      this.update({
        phase: "disconnected",
        snapshot: null,
        verified: false,
        error: "DISCONNECTED",
      });
    });
  }
  get state(): OperationState {
    return {
      ...this.current,
      snapshot: this.current.snapshot
        ? parseConfig(this.current.snapshot.raw)
        : null,
      log: this.current.log.map((e) => ({ ...e })),
    };
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<OperationState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }
  private log(event: string): void {
    this.update({
      log: [
        ...this.current.log.slice(-99),
        { time: new Date(this.clock()).toISOString(), event },
      ],
    });
  }
  private phase(phase: Phase): void {
    this.update({
      phase,
      progress: 0,
      log: [
        ...this.current.log.slice(-99),
        { time: new Date(this.clock()).toISOString(), event: phase },
      ],
    });
  }
  private async exclusive<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.active) throw new AppError("STALE_OPERATION");
    const controller = new AbortController();
    this.active = controller;
    this.update({ error: null, verified: false });
    try {
      return await operation(controller.signal);
    } catch (error) {
      const code = errorCode(error);
      this.update({
        phase: this.transport.isConnected() ? "error" : "disconnected",
        error: code,
        verified: false,
      });
      throw error instanceof AppError ? error : new AppError(code);
    } finally {
      controller.abort();
      if (this.active === controller) this.active = null;
    }
  }
  connect(): Promise<void> {
    return this.exclusive(async (signal) => {
      this.pending = null;
      this.generation++;
      this.phase("choosing");
      await abortable(this.transport.connectFromUserGesture(), signal);
      this.phase("reading");
      const snapshot = await this.read(signal);
      this.update({ snapshot, phase: "ready" });
    });
  }
  disconnect(): void {
    this.pending = null;
    this.generation++;
    this.active?.abort(new AppError("DISCONNECTED"));
    this.transport.disconnect();
    this.update({
      phase: "disconnected",
      snapshot: null,
      error: null,
      verified: false,
    });
  }
  dismissError(): void {
    this.update({ error: null });
  }
  connectionPhase(phase: "connecting" | "subscribing"): void {
    if (this.active) this.phase(phase);
  }
  dispose(): void {
    this.disconnect();
    this.unsubscribe();
    this.listeners.clear();
  }
  readCurrentConfig(): Promise<ConfigSnapshot> {
    return this.exclusive(async (signal) => {
      this.pending = null;
      this.phase("reading");
      const snapshot = await this.read(signal);
      this.update({ snapshot, phase: "ready" });
      return parseConfig(snapshot.raw);
    });
  }
  private async read(signal: AbortSignal): Promise<ConfigSnapshot> {
    if (!this.transport.isConnected()) throw new AppError("DISCONNECTED");
    const stream = this.transport.notifications();
    const controller = new AbortController();
    const relay = () => controller.abort(signal.reason);
    signal.addEventListener("abort", relay, { once: true });
    if (signal.aborted) relay();
    const pages: ConfigPage[] = [];
    const offsets = new Set<number>();
    const timer = setTimeout(
      () =>
        controller.abort(
          new AppError(offsets.size ? "INCOMPLETE_CONFIG" : "READ_TIMEOUT"),
        ),
      this.timing.readTimeout,
    );
    const collect = async () => {
      while (offsets.size < 4) {
        const next = await abortable(stream.next(), controller.signal);
        if (next.done) throw new AppError("DISCONNECTED");
        this.update({ notificationLength: next.value.byteLength });
        const page = parseConfigNotification(next.value);
        if (!page) continue;
        const previous = pages.find((p) => p.offset === page.offset);
        if (previous && !equalBytes(previous.payload, page.payload))
          throw new AppError("CONFLICTING_PAGE");
        if (!previous) {
          pages.push(page);
          offsets.add(page.offset);
          this.update({ progress: offsets.size });
        }
      }
      return parseConfig(assembleConfigPages(pages));
    };
    const send = async () => {
      for (const packet of [
        ...loadPreamble(),
        ...PAGE_OFFSETS.map(buildReadRequest),
      ]) {
        controller.signal.throwIfAborted();
        await abortable(
          this.transport.writeWithResponse(packet),
          controller.signal,
        );
        if (this.timing.loadDelay)
          await delay(this.timing.loadDelay, controller.signal);
      }
    };
    try {
      const [snapshot] = await Promise.all([collect(), send()]);
      return snapshot;
    } catch (error) {
      controller.abort(error);
      this.transport.disconnect();
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal.removeEventListener("abort", relay);
      await stream.return?.();
    }
  }
  prepareSave(edits: ConfigEdits): Promise<PreparedSave> {
    const owned = structuredClone(edits);
    return this.exclusive(async (signal) => {
      this.pending = null;
      this.phase("preparing");
      const baseline = await this.read(signal);
      if (
        !this.current.snapshot ||
        !equalBytes(baseline.raw, this.current.snapshot.raw)
      )
        throw new AppError("DEVICE_CHANGED");
      const expected = applyConfigEdits(baseline, owned);
      return this.prepare(baseline, expected, "pre-save", [], signal);
    });
  }
  prepareRestore(id: string): Promise<PreparedSave> {
    return this.exclusive(async (signal) => {
      this.pending = null;
      this.phase("preparing");
      const selected = parseConfig(
        await abortable(this.backups.get(id), signal),
      );
      const baseline = await this.read(signal);
      const edits: ConfigEdits = { mappings: {} };
      const skipped: string[] = [];
      for (const button of BUTTONS) {
        const value = selected.mappings[button.id];
        if (value.kind === "chord") edits.mappings[button.id] = value;
        else skipped.push(button.id);
      }
      if (selected.disableSleep !== null && baseline.disableSleep !== null)
        edits.disableSleep = selected.disableSleep;
      else skipped.push("disableSleep");
      return this.prepare(
        baseline,
        applyConfigEdits(baseline, edits),
        "pre-restore",
        skipped,
        signal,
      );
    });
  }
  private async prepare(
    baseline: ConfigSnapshot,
    expected: Uint8Array,
    reason: BackupReason,
    skipped: string[],
    signal: AbortSignal,
  ): Promise<PreparedSave> {
    let backupId: string;
    try {
      backupId = await abortable(
        this.backups.save(baseline.raw.slice(), reason),
        signal,
      );
    } catch {
      signal.throwIfAborted();
      throw new AppError("BACKUP_FAILED");
    }
    const target = parseConfig(expected);
    const changes: Change[] = [];
    for (const button of BUTTONS)
      if (
        !equalBytes(
          baseline.raw.slice(button.offset, button.offset + 4),
          expected.slice(button.offset, button.offset + 4),
        )
      )
        changes.push({
          label: button.label,
          before: formatChord(baseline.mappings[button.id]),
          after: formatChord(target.mappings[button.id]),
        });
    if (baseline.disableSleep !== target.disableSleep)
      changes.push({
        label: "自動スリープを無効化",
        before: baseline.disableSleep ? "オン" : "オフ",
        after: target.disableSleep ? "オン" : "オフ",
      });
    const token: PreparedSave = Object.freeze({
      changes: Object.freeze(changes.map((c) => Object.freeze(c))),
      skipped: Object.freeze(skipped),
      reason,
      backupId,
    });
    this.pending = {
      token,
      expected: expected.slice(),
      baseline: baseline.raw.slice(),
      generation: this.generation,
      createdAt: this.clock(),
    };
    this.phase("confirming");
    return token;
  }
  cancelPrepared(): void {
    this.pending = null;
    if (!this.active)
      this.update({
        phase: this.transport.isConnected() ? "ready" : "disconnected",
      });
  }
  commitSave(token: PreparedSave): Promise<ConfigSnapshot> {
    return this.exclusive(async (signal) => {
      const pending = this.pending;
      this.pending = null;
      if (
        !pending ||
        pending.token !== token ||
        pending.generation !== this.generation ||
        this.clock() - pending.createdAt > this.timing.preparedTtl ||
        !this.transport.isConnected()
      )
        throw new AppError("STALE_OPERATION");
      try {
        const backup = await abortable(
          this.backups.get(token.backupId),
          signal,
        );
        if (!equalBytes(backup, pending.baseline)) throw new Error();
      } catch {
        signal.throwIfAborted();
        throw new AppError("BACKUP_FAILED");
      }
      if (equalBytes(pending.baseline, pending.expected)) {
        this.update({
          snapshot: parseConfig(pending.baseline),
          phase: "ready",
        });
        return parseConfig(pending.baseline);
      }
      this.phase("saving");
      for (const [index, offset] of PAGE_OFFSETS.entries()) {
        try {
          await withDeadline(
            this.transport.writeWithResponse(
              buildWritePage(
                offset,
                pending.expected.slice(offset, offset + PAGE_LENGTH),
              ),
            ),
            this.timing.readTimeout,
            new AppError("WRITE_FAILED"),
            signal,
          );
        } catch {
          signal.throwIfAborted();
          this.transport.disconnect();
          throw new AppError("WRITE_FAILED");
        }
        this.update({ progress: index + 1 });
        if (this.timing.saveDelay) await delay(this.timing.saveDelay, signal);
      }
      this.phase("committing");
      try {
        await withDeadline(
          this.transport.writeWithResponse(buildCommitPacket()),
          this.timing.readTimeout,
          new AppError("COMMIT_FAILED"),
          signal,
        );
      } catch {
        signal.throwIfAborted();
        this.transport.disconnect();
        throw new AppError("COMMIT_FAILED");
      }
      this.phase("verifying");
      let snapshot: ConfigSnapshot;
      try {
        snapshot = await this.read(signal);
      } catch (error) {
        this.log(
          `保存後の読み戻し失敗: ${errorCode(error)} / 受信 ${this.current.progress}/4 ページ`,
        );
        if (errorCode(error) === "DISCONNECTED") throw error;
        throw new AppError("VERIFY_FAILED");
      }
      // Hardware observation: commit updates offsets 0–1. Their meaning is
      // unknown; preserve them on write, accept the returned bytes only after
      // all four page CRCs and every byte at offsets 2–179 have been verified.
      // See docs/save-investigation.md. This exception applies only to readback.
      if (!equalBytes(snapshot.raw.slice(2), pending.expected.slice(2))) {
        const offsets = Array.from(snapshot.raw.keys()).filter(
          (offset) => snapshot.raw[offset] !== pending.expected[offset],
        );
        this.log(
          `読み戻し不一致: ${offsets.length} バイト / オフセット (0始まり): ${offsets.join(", ")}`,
        );
        throw new AppError("VERIFY_FAILED");
      }
      if (!equalBytes(snapshot.raw.slice(0, 2), pending.expected.slice(0, 2))) {
        this.log(
          "本体が先頭2バイトを更新。ページCRCと残り178バイトの一致を確認",
        );
      }
      this.update({ snapshot, phase: "ready", verified: true });
      return parseConfig(snapshot.raw);
    });
  }
}
