import { createOperationStore } from "./store";
import {
  ControllerService,
  DEFAULT_TIMING,
  type TimingPolicy,
} from "./controller-service";
import type { MicroTransport } from "../ble/micro-transport";
import { WebBluetoothTransport } from "../ble/web-bluetooth-transport";
import { MicroDatabase } from "../storage/database";
import { RawBackups } from "../storage/raw-backups";
import { Profiles } from "../storage/profiles";
export function createRuntime(
  factory?: () => MicroTransport,
  db = new MicroDatabase(),
  supported = Boolean(
    globalThis.navigator?.bluetooth && globalThis.isSecureContext,
  ),
  timing: TimingPolicy = DEFAULT_TIMING,
) {
  const transport =
    factory?.() ??
    new WebBluetoothTransport(undefined, (phase) =>
      service.connectionPhase(phase),
    );
  const backups = new RawBackups(db);
  const profiles = new Profiles(db);
  const service: ControllerService = new ControllerService(
    transport,
    backups,
    timing,
  );
  const { store, unsubscribe } = createOperationStore(service);
  return {
    service,
    store,
    backups,
    profiles,
    supported,
    dispose() {
      unsubscribe();
      service.dispose();
      db.close();
    },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
