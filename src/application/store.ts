import { createStore } from "zustand/vanilla";
import type { ControllerService } from "./controller-service";
export function createOperationStore(service: ControllerService) {
  const store = createStore(() => service.state);
  const unsubscribe = service.subscribe(() =>
    store.setState(service.state, true),
  );
  return { store, unsubscribe };
}
