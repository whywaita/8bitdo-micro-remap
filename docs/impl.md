# 8BitDo Micro Web Configurator — Implementation Plan

Status: ready for a coding agent
Depends on: `design.md`
Last updated: 2026-09-09

## 1. Instructions to the implementing agent

Read `design.md` completely before editing code. Treat its safety invariants and protocol byte layouts as requirements.

Do not improvise unknown protocol fields. Do not copy code from a repository without confirming its license. Implement the documented protocol facts independently and keep links to provenance in comments or project documentation.

Work milestone by milestone. At the end of every milestone:

1. run the relevant tests;
2. run formatting and type checking;
3. record unresolved assumptions;
4. do not proceed past a failing safety test.

The implementation is TypeScript-only. Do not introduce Rust, Wasm, a server database, authentication, telemetry, or WebUSB unless the requirements are explicitly revised.

## 2. Bootstrap

Create a React + TypeScript + Vite application configured for Cloudflare Workers.

Required development tools:

- a current Node.js LTS release;
- pnpm with a committed `pnpm-lock.yaml`;
- Wrangler through the project dependency, not a required global installation.

Install production dependencies:

```text
react
react-dom
zustand
dexie
zod
```

Install development dependencies:

```text
typescript
vite
@vitejs/plugin-react
@cloudflare/vite-plugin
wrangler
vitest
@vitest/coverage-v8
@testing-library/react
@testing-library/user-event
jsdom
playwright
eslint
prettier
```

Enable TypeScript strict mode, including:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "useUnknownInCatchVariables": true
}
```

Add scripts:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "lint": "eslint .",
  "format:check": "prettier --check .",
  "deploy": "pnpm build && wrangler deploy"
}
```

Deliverable: the empty SPA runs locally through the Cloudflare Vite environment and deploy configuration validates.

## 3. Target file tree

```text
src/
├─ application/
│  ├─ controller-service.ts
│  ├─ errors.ts
│  ├─ operation-state.ts
│  └─ store.ts
├─ ble/
│  ├─ command-queue.ts
│  ├─ micro-transport.ts
│  ├─ notification-stream.ts
│  └─ web-bluetooth-transport.ts
├─ protocol/
│  ├─ buttons.ts
│  ├─ config.ts
│  ├─ constants.ts
│  ├─ crc16.ts
│  ├─ hid-codec.ts
│  ├─ initialization.ts
│  ├─ packets.ts
│  └─ types.ts
├─ storage/
│  ├─ database.ts
│  ├─ profiles.ts
│  ├─ raw-backups.ts
│  └─ schemas.ts
├─ ui/
│  ├─ App.tsx
│  ├─ components/
│  └─ styles.css
├─ main.tsx
└─ worker.ts
tests/
├─ e2e/
├─ fixtures/
└─ helpers/
vite.config.ts
vitest.config.ts
playwright.config.ts
wrangler.jsonc
```

Unit tests should live beside their modules or in a parallel `tests/unit` tree; choose one convention and use it consistently.

## 4. Milestone 1 — Pure protocol core

Implement this milestone before any UI or browser Bluetooth code.

### 4.1 Constants and button table

Create `src/protocol/constants.ts`:

```ts
export const CONFIG_LENGTH = 180;
export const PAGE_LENGTH = 45;
export const READ_RESPONSE_LENGTH = 61;
export const WRITE_PACKET_LENGTH = 62;
export const PAGE_OFFSETS = [0x00, 0x2d, 0x5a, 0x87] as const;
export const DISABLE_SLEEP_OFFSET = 0x03;
```

Create `src/protocol/buttons.ts` with the exact 16 button-to-slot mappings from `design.md`. Expose ordered arrays and maps by ID. Assert uniqueness of IDs, slots, and byte offsets in tests.

### 4.2 CRC-16

Create `src/protocol/crc16.ts`:

```ts
export function crc16(data: Uint8Array): number;
```

Implementation requirements:

- initial value `0xffff`;
- reflected polynomial `0xa001`;
- unsigned shifts with `>>>`;
- return `crc & 0xffff`.

Tests:

- 45 zero bytes produce `0xcf30`.
- empty input produces `0xffff`.
- at least two captured nonzero page vectors match their stored CRC.
- flipping one payload bit causes validation failure.

### 4.3 HID codec

Create `src/protocol/hid-codec.ts`.

Required API:

```ts
export type Modifier = "ctrl" | "alt" | "shift" | "meta";

export interface HidChord {
  kind: "chord";
  modifiers: Modifier[];
  key: number | null;
}

export function encodeChord(chord: HidChord): Uint8Array;
export function decodeChord(bytes: Uint8Array): DecodedMapping;
export function formatChord(value: DecodedMapping): string;
```

Use the `DecodedMapping` union defined in `design.md`, including the `kind` discriminant and owned four-byte raw representation. Share these types through `src/protocol/types.ts`.

Validation:

- input must encode to exactly four bytes;
- no duplicate modifiers;
- at most one non-modifier key;
- no more than three modifiers when a non-modifier key is present;
- disabled mapping encodes as four zeros;
- canonical order is Ctrl, Alt, Shift, Meta, then key;
- unknown/multiple non-modifier combinations round-trip as an explicit raw representation and are not normalized silently.

Include USB HID codes for letters, digits, Enter, Escape, Backspace, Tab, Space, punctuation, F1–F24, navigation, arrows, and keypad keys used by the initial UI.

### 4.4 Packet parsing/building

Create `src/protocol/packets.ts` with:

```ts
export interface ConfigPage {
  offset: (typeof PAGE_OFFSETS)[number];
  payload: Uint8Array;
}

export function buildReadRequest(offset: number): Uint8Array;
export function parseConfigNotification(packet: Uint8Array): ConfigPage | null;
export function buildWritePage(offset: number, payload: Uint8Array): Uint8Array;
export function buildCommitPacket(): Uint8Array;
export function buildWriteSequence(config: Uint8Array): Uint8Array[];
```

`parseConfigNotification()` returns `null` only for unrelated notification types. A related but malformed configuration packet throws a typed protocol error. This distinction prevents corrupted data from being silently ignored.

Use `DataView.getUint16/setUint16` and `getUint32/setUint32` with `littleEndian=true`. Never depend on host endianness.

Golden tests must assert complete byte arrays for:

- read requests for all four offsets;
- at least one write page;
- commit packet;
- valid response parsing;
- invalid length, payload length, offset, CRC, and conflicting duplicate cases.

Use the sanitized complete response vectors in `design.md`; do not make the first implementation depend on downloading fixtures at test time.

### 4.5 Configuration model

Create `src/protocol/config.ts`:

```ts
export interface ConfigSnapshot {
  raw: Uint8Array;
  mappings: Readonly<Record<ButtonId, DecodedMapping>>;
  disableSleep: boolean | null;
}

export function assembleConfigPages(pages: Iterable<ConfigPage>): Uint8Array;
export function parseConfig(payload: Uint8Array): ConfigSnapshot;
export function applyConfigEdits(
  baseline: ConfigSnapshot,
  edits: ConfigEdits,
): Uint8Array;
```

Requirements:

- require exactly four expected offsets;
- reject missing and conflicting duplicate pages;
- own all returned buffers using `.slice()`;
- modify a copy of `baseline.raw`;
- touch only confirmed slot bytes and optional Disable Sleep;
- preserve unknown Disable Sleep values when no valid edit is allowed.

Add a property-style test that fills the 180-byte baseline with deterministic pseudo-random values, edits one mapping, and asserts every byte outside that four-byte range is identical.

Milestone gate:

```text
all protocol unit tests pass
100% branch coverage for CRC and packet validation
no DOM imports in src/protocol
```

## 5. Milestone 2 — Transport abstraction and fake device

### 5.1 Interface

Implement `MicroTransport` from `design.md`. Prefer an async notification iterator backed by a small queue. It must support listener cleanup and cancellation.

### 5.2 Command queue

Implement a FIFO `GattCommandQueue`:

```ts
export class GattCommandQueue {
  enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  cancel(reason?: unknown): void;
  waitForIdle(): Promise<void>;
}
```

Tests must demonstrate:

- strict ordering;
- one rejected operation does not execute later operations concurrently;
- disconnect cancellation rejects queued operations;
- no unhandled promise rejection.

### 5.3 Scripted fake transport

Create `tests/helpers/scripted-transport.ts`. It should:

- record every write;
- emit configured notifications after selected writes;
- simulate timeout, CRC corruption, duplicate pages, write failure, and disconnect;
- expose no Web Bluetooth types so it can run in Node/Vitest.

Do not begin real browser integration until the application service passes against the fake.

## 6. Milestone 3 — Application orchestration

Create `ControllerService`, constructed with `MicroTransport`, backup repository, clock, and timing policy.

Suggested API:

```ts
export class ControllerService {
  connect(): Promise<void>;
  disconnect(): void;
  readCurrentConfig(): Promise<ConfigSnapshot>;
  prepareSave(edits: ConfigEdits): Promise<PreparedSave>;
  commitSave(prepared: PreparedSave): Promise<VerifiedSaveResult>;
  restoreBackup(id: string): Promise<VerifiedSaveResult>;
}
```

`prepareSave()` must:

1. read a fresh full baseline;
2. encode every edit;
3. create expected bytes using read-modify-write;
4. persist and await a raw backup;
5. return a human-readable diff and an opaque prepared operation.

`commitSave()` must reject a prepared operation that is stale, already used, belongs to another connection generation, or lacks a persisted backup.

After page writes and commit, reread and compare all 180 bytes. Return success only on exact equality.

Required failure tests:

- incomplete initial read;
- invalid response CRC;
- backup transaction failure prevents every configuration-page write and commit;
- write failure on pages 1–4 prevents commit;
- commit write failure;
- incomplete verification read;
- mapping mismatch;
- unknown-byte mismatch;
- disconnect during every phase;
- two simultaneous save attempts;
- stale prepared save after reconnect;
- user cancellation causes no configuration-page write or commit.

Initialization and read-request GATT writes are allowed before backup persistence and user confirmation. Tests must classify recorded packets by command type rather than assert an empty transport write log.

Restore must follow `design.md` section 9.3: overlay supported backup fields onto the fresh current baseline, preserve current unknown bytes, report skipped mappings or Disable Sleep values, persist a recovery backup, and obtain confirmation before writing. Test differing unknown bytes between backup and current device, unsupported backup mappings, unconfirmed Disable Sleep in either snapshot, backup failure, cancellation, and stale confirmation. Verify against the prepared overlay, not the original backup payload.

Application errors must be typed and mapped to safe user messages. Do not expose raw packet bytes in normal errors.

## 7. Milestone 4 — Web Bluetooth implementation

Add TypeScript declarations for Web Bluetooth only if the selected TypeScript DOM library lacks them. Prefer a maintained type package or narrow local declarations over `any`.

Implement `WebBluetoothTransport`:

1. feature-detect `navigator.bluetooth`;
2. call `requestDevice()` from the public connect method without scheduling it through a later timer;
3. filter for `80EL` or `8BitDo` and request access to the custom service;
4. connect and resolve exact UUIDs;
5. subscribe before any protocol write;
6. copy every `DataView` notification immediately into a new `Uint8Array`;
7. use `writeValueWithResponse()`;
8. invalidate handles and cancel the queue on disconnect;
9. reacquire all handles on reconnect;
10. remove event listeners during disconnect/disposal.

Do not select the first writable characteristic. Require the known characteristic UUID.

Add a browser-only diagnostic screen behind a development flag that shows semantic events and packet lengths, but not addresses or full raw payloads.

Manual gate:

- Chromium opens a filtered device chooser from a button click.
- Selecting no device produces a nonfatal cancellation state.
- Selecting a Micro in K mode connects and starts notifications.
- Disconnecting the device updates the UI within one event turn.

## 8. Milestone 5 — IndexedDB persistence

Create a Dexie database with independent `rawBackups` and `profiles` tables.

### 8.1 Raw backup requirements

- Schema exactly follows `RawBackupV1` in `design.md`.
- Convert bytes to/from Base64 with a tested helper that does not spread very large arrays into function arguments.
- Validate reads and imports with strict Zod schemas.
- Require decoded payload length 180.
- Store no Bluetooth address or device name.
- Keep backups until explicitly deleted; do not silently evict recovery data.

### 8.2 Profile requirements

- Store only known mapping semantics and optional Disable Sleep.
- Validate every key code and chord.
- Export with a deterministic JSON format.
- Import into a draft only; import must never write directly to the device.

Tests must use fake IndexedDB and cover schema rejection, corrupted Base64, wrong payload length, transaction failure, ordering by timestamp, import, and export.

## 9. Milestone 6 — React UI

Build in this order:

1. compatibility and connection card;
2. operation/status banner;
3. read-only mapping grid;
4. mapping editor;
5. dirty-state handling;
6. save confirmation;
7. backup restore UI;
8. profile import/export;
9. accessibility and responsive layout.

### 9.1 Mapping editor behavior

- Clicking a button opens an editor without changing the persisted/current mapping.
- Support key picker and physical keyboard capture.
- Escape is a valid mapping and must not automatically close the editor while capture is active.
- Apply updates only the local draft.
- Cancel discards the editor draft.
- Disabled mapping is explicit and displays clearly.
- Unknown raw mappings display as hexadecimal and are preserved until the user intentionally replaces them.

### 9.2 Save UX

- Save is disabled unless connected, ready, and the draft is valid.
- Save starts by rereading the device.
- If the device changed since the displayed snapshot, stop and ask the user to reload/review.
- Show decoded before/after values and backup creation status.
- Require explicit confirmation.
- During save and verification, disable all conflicting controls.
- Display “Verified” only after exact readback.

### 9.3 Accessibility

- Full keyboard operation.
- Visible focus states.
- Buttons use real `<button>` elements.
- Status changes use an appropriate `aria-live` region.
- Do not communicate success/failure by color alone.
- Maintain usable layout at 320 CSS pixels wide.

Component tests should cover the unsupported-browser path, chooser cancellation, read errors, draft cancellation, save confirmation, verification failure, disconnect, and successful restore.

## 10. Milestone 7 — Cloudflare Worker

Configure `@cloudflare/vite-plugin` and Workers Static Assets.

Use `wrangler.jsonc` with:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "8bitdo-micro-configurator",
  "main": "./src/worker.ts",
  "compatibility_date": "2026-09-08",
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true,
  },
  "observability": {
    "enabled": true,
  },
}
```

The Worker must:

- serve assets through `env.ASSETS`;
- expose an optional `/api/health` returning only build health;
- add `X-Content-Type-Options: nosniff`;
- add `Referrer-Policy: no-referrer`;
- add `Permissions-Policy: bluetooth=(self)`;
- add a restrictive CSP with no `wasm-unsafe-eval`;
- add `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri 'none'`;
- avoid logging query strings, request bodies, or device data.

Do not create D1, KV, R2, Durable Objects, or secrets for the first release.

Tests must verify headers for the SPA root, a nested SPA route, and a static asset. Confirm that the deployed origin is HTTPS and Web Bluetooth is not blocked by the permissions policy.

## 11. Milestone 8 — End-to-end fake-device tests

The production app must accept a transport factory so test builds can inject `ScriptedTransport` without changing protocol code.

Playwright scenarios:

1. unsupported browser message;
2. connect and load four pages;
3. edit one mapping, cancel, and observe no change;
4. edit one mapping and save successfully;
5. verify that a backup exists before the first recorded configuration-page write;
6. fail page 3 write and verify commit was not sent;
7. corrupt a readback CRC and verify failure;
8. return a valid but mismatching unknown byte and verify failure;
9. disconnect during verification and recover to disconnected state;
10. restore supported fields from a backup, preserve current unknown bytes, and verify the complete prepared payload;
11. reload the SPA at a nested route through the Worker;
12. reload and confirm local backups remain available.

Do not attempt to automate the native Bluetooth chooser in normal Playwright CI.

## 12. Milestone 9 — Hardware verification

Use a test Micro that can be recovered with the official mobile application.

Before testing:

- record browser, OS, Micro firmware, and application commit;
- export or screenshot the current official-app mapping;
- choose a harmless, easily recognizable mapping change;
- verify that the local backup store is empty or understood.

Test procedure:

1. Put the Micro in K mode.
2. Connect from the deployed HTTPS site.
3. Read four CRC-valid pages.
4. Save one harmless mapping change.
5. Confirm that the application reports full 180-byte verified readback.
6. Disconnect the browser.
7. Open the official mobile app and independently confirm the mapping.
8. Reconnect to the web app and restore the pre-save backup.
9. Confirm exact readback against the prepared restore payload and preservation of current unknown bytes.
10. Confirm restoration independently in the official mobile app.
11. Repeat once on a second Chromium/OS combination if available.

Record only semantic results. Do not commit Bluetooth addresses, device names, raw captures, or backup payloads.

If any step fails, mark hardware verification failed and preserve the backup. Do not weaken CRC or readback checks to make the test pass.

## 13. CI and quality gates

Every pull request must run:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Required gates:

- zero TypeScript errors;
- zero lint errors;
- protocol golden tests pass;
- no test snapshots containing raw controller configurations;
- no network request from client code except same-origin application assets/API;
- production bundle contains no Bluetooth address or captured private packet dump;
- Worker deployment dry-run succeeds;
- dependency lockfile is committed.

Use dependency update tooling only after the first hardware-verified release, and require protocol tests on every update.

## 14. Error taxonomy

Define typed errors with stable codes:

```text
UNSUPPORTED_BROWSER
CHOOSER_CANCELLED
CONNECTION_FAILED
SERVICE_NOT_FOUND
CHARACTERISTIC_NOT_FOUND
DISCONNECTED
WRITE_FAILED
READ_TIMEOUT
INCOMPLETE_CONFIG
INVALID_PACKET
INVALID_CRC
CONFLICTING_PAGE
INVALID_MAPPING
DEVICE_CHANGED
BACKUP_FAILED
COMMIT_FAILED
VERIFY_FAILED
STALE_OPERATION
```

User messages should explain the next safe action. Internal error details may contain packet type, length, offset, and operation phase, but not complete payload hex or device identity.

## 15. Definition of done

The first release is complete only when all of the following are true:

- The SPA is deployed through Cloudflare Workers over HTTPS.
- Supported Chromium browsers can connect to a Micro in K mode.
- All four configuration pages are read and CRC-validated.
- All 16 known mappings decode and edit correctly.
- Save begins with a fresh read and committed local backup.
- Only confirmed bytes change.
- Four pages are written with correct CRCs, followed by commit.
- Full 180-byte readback matches before success is shown.
- Restore creates a pre-restore backup, requires confirmation, preserves current unknown bytes, and verifies exact readback against the prepared payload.
- Unsupported browsers receive clear guidance.
- Raw controller data remains local by default.
- Automated unit, component, Worker, and fake-device E2E suites pass.
- Save and restore are independently cross-checked on real hardware with the official mobile app.
- README documents limitations, supported platforms, recovery, protocol provenance, and verification level.

## 16. Deferred work

After the first hardware-verified release, possible follow-ups are:

- broader browser/platform testing;
- installable PWA shell and offline asset caching;
- opt-in encrypted profile synchronization;
- additional Micro firmware compatibility fixtures;
- Tauri wrapper reusing the pure TypeScript protocol tests or a future Rust port;
- investigation of device-side profile management and currently unknown packets.

Each new protocol field requires independent evidence, golden vectors, byte-preservation tests, and a documented recovery procedure before it may be written.
