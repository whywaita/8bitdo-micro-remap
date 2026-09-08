# 8BitDo Micro Web Configurator — Design

Status: implementation-ready draft
Last updated: 2026-09-09

## 1. Purpose

Build a browser-based configurator for the 8BitDo Micro that can read, edit, back up, write, and verify the active keyboard-mode keymap.

The application is a TypeScript single-page application hosted with Cloudflare Workers Static Assets. Bluetooth communication runs locally in the user's browser through Web Bluetooth. Cloudflare Workers never communicate with the controller.

## 2. Product decisions

### 2.1 Required platform

- Chromium browser with Web Bluetooth support, initially Chrome or Edge on Windows, macOS, ChromeOS, or Android.
- Secure context: production HTTPS or localhost during development.
- 8BitDo Micro switched to `K`/keyboard mode.
- A user gesture is required to open the Bluetooth device chooser.

Safari and Firefox are not supported in the first release. The UI must detect missing `navigator.bluetooth` support and explain this before showing the connect action.

### 2.2 Technology stack

- TypeScript in strict mode.
- React for UI.
- Vite and `@cloudflare/vite-plugin` for local development and build.
- Cloudflare Workers Static Assets for hosting.
- Native Web Bluetooth API for BLE GATT access.
- `Uint8Array` and `DataView` for protocol data.
- Zustand for application state.
- Dexie/IndexedDB for private local profiles and raw configuration backups.
- Zod for persisted-document validation.
- Vitest for unit and component tests.
- Playwright for browser flows using a fake transport; real Bluetooth verification remains a manual hardware test.

Rust and WebAssembly are intentionally excluded. The protocol consists of small byte buffers, CRC-16, and deterministic parsing; TypeScript is sufficient and avoids a second toolchain and Wasm boundary.

## 3. Scope

### 3.1 In scope

- Detect browser support and explain platform requirements.
- Ask the user to select an 8BitDo Micro.
- Connect to the BLE GATT service and subscribe to notifications.
- Read all four 45-byte configuration pages, totaling 180 bytes.
- Validate packet shape, offsets, payload length, and CRC.
- Decode the 16 known physical-button mapping slots.
- Decode and encode supported USB HID keyboard usages and chords.
- Edit mappings locally without immediately writing them.
- Read and edit the confirmed Disable Sleep flag at global byte offset `0x03` when its value is `0x00` or `0x01`.
- Back up the complete 180-byte baseline before every write.
- Apply edits with read-modify-write so all unknown bytes are preserved.
- Recalculate the CRC for every page written.
- Commit, reread, and verify the complete configuration.
- Restore supported known fields from a selected local raw backup with the same safeguards; preserve all other bytes from the current device.
- Import and export human-readable named profiles without raw device identifiers.
- Recover cleanly from disconnects, timeouts, and partial reads.

### 3.2 Out of scope

- S-mode or D-mode configuration.
- USB/WebUSB communication.
- Firmware updates.
- Device pairing without the browser chooser.
- Device-side profile names, profile selection, or multiple on-device profiles.
- Mouse actions, media keys, macros, and other unverified fields.
- Background Bluetooth operation after the page is closed.
- Cloud synchronization or accounts in the first release.
- Writing any field that has not been independently identified.

## 4. Safety invariants

These are hard requirements, not suggestions.

1. Never construct an entire configuration from a hard-coded template.
2. Never write unless a fresh, complete, CRC-valid 180-byte baseline was read during the current connection.
3. Modify only the 16 confirmed mapping slots and, when valid, Disable Sleep byte `0x03`.
4. Preserve every other baseline byte exactly.
5. Create a local raw backup before the first configuration-page write packet. Initialization and read requests may precede the backup.
6. Serialize all GATT operations; no concurrent reads or writes.
7. Write four 45-byte pages and recompute each page CRC.
8. Send the observed commit packet only after all page writes succeed.
9. Reread all four pages after commit and validate all page CRCs and compare bytes 2–179 with the expected payload; accept device-updated bytes 0–1 only for post-save readback.
10. Do not report success after only a GATT write acknowledgement.
11. On verification failure, retain the backup and show recovery instructions.
12. Never upload raw configurations, Bluetooth addresses, device names, or notification dumps by default.

## 5. Architecture

```text
React UI
  -> application store / operation state machine
    -> MicroSession
      -> serialized WebBluetoothTransport
      -> pure protocol modules
    -> IndexedDB backup/profile repositories

Cloudflare Worker
  -> security headers
  -> SPA/static-asset delivery
```

### 5.1 Layer boundaries

`src/protocol` must be pure TypeScript with no DOM, React, Web Bluetooth, IndexedDB, or Worker imports. All functions accept and return owned byte arrays or plain data objects.

`src/ble` owns browser APIs, notification collection, timing, connection lifecycle, and transport errors. It does not interpret button mappings.

`src/application` orchestrates read, save, verify, and restore. It enforces the safety invariants.

`src/storage` owns local persistence. Raw backups and named profiles use separate schemas.

`src/ui` renders state and dispatches user intent. Components never call a GATT characteristic directly.

`src/worker.ts` only serves the application and adds headers. It receives no controller data.

## 6. BLE transport

### 6.1 Known identifiers

```ts
export const MICRO_SERVICE_UUID = "0000ff10-0000-1000-8000-00805f9b34fb";

export const MICRO_CHARACTERISTIC_UUID = "0000ff13-0000-1000-8000-00805f9b34fb";
```

The observed keyboard-mode advertising name is `80EL`. The chooser should use OR filters for exact `80EL` and an `8BitDo` prefix, with `MICRO_SERVICE_UUID` in `optionalServices`. Do not use `acceptAllDevices` in normal operation.

### 6.2 Connection sequence

1. A click handler calls `navigator.bluetooth.requestDevice()` directly.
2. Connect to `device.gatt`.
3. Resolve the primary service and characteristic by exact UUID.
4. Register `gattserverdisconnected`.
5. Call `startNotifications()`.
6. Register `characteristicvaluechanged` before sending protocol packets.
7. Run the observed initialization/load sequence through the serialized command queue.

After reconnecting, reacquire the service and characteristic. Web Bluetooth GATT objects from the previous connection must not be reused.

### 6.3 Transport interface

```ts
export interface MicroTransport {
  connectFromUserGesture(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  writeWithResponse(packet: Uint8Array): Promise<void>;
  notifications(): AsyncIterable<Uint8Array>;
  onDisconnected(listener: () => void): () => void;
}
```

The production implementation uses Web Bluetooth. Tests use an in-memory scripted transport.

### 6.4 GATT queue

All characteristic operations pass through one FIFO queue. Writes use `writeValueWithResponse()`. The queue supports cancellation on disconnect and a configurable delay after each write.

Defaults:

- Load-sequence delay: 180 ms between packets.
- Save-sequence delay: 120 ms between packets.
- Full read timeout: 8 seconds.
- Expected configuration pages: 4 distinct offsets.

Timing values are protocol policy constants and must be easy to change after hardware testing.

## 7. Protocol specification

### 7.1 Configuration layout

- Total payload: 180 bytes.
- Pages: four pages of 45 bytes.
- Page offsets: `0x00`, `0x2d`, `0x5a`, `0x87`.
- Mapping width: four bytes per slot.
- Slot byte offset: `slot * 4` in the complete payload.
- Disable Sleep: global byte offset `0x03`; `0x00` is off and `0x01` is on.

Known mappings:

| Physical button | Slot | Global byte offset |
| --------------- | ---: | -----------------: |
| A               |    3 |             `0x0c` |
| B               |    4 |             `0x10` |
| X               |    5 |             `0x14` |
| Y               |    6 |             `0x18` |
| L / L1          |    7 |             `0x1c` |
| R / R1          |    8 |             `0x20` |
| L2              |    9 |             `0x24` |
| R2              |   10 |             `0x28` |
| Minus / Select  |   13 |             `0x34` |
| Plus / Start    |   14 |             `0x38` |
| Star            |   15 |             `0x3c` |
| Logo            |   16 |             `0x40` |
| Up              |   17 |             `0x44` |
| Down            |   18 |             `0x48` |
| Left            |   19 |             `0x4c` |
| Right           |   20 |             `0x50` |

Labels are UI names; slot numbers are the protocol identity.

### 7.2 Mapping encoding

Each mapping is four USB HID Keyboard/Keypad Usage IDs. Unused positions are zero.

Examples:

```text
A              04 00 00 00
Enter          28 00 00 00
Ctrl+W         E0 1A 00 00
Ctrl+Shift+T   E0 E1 17 00
Alt+F4         E2 3D 00 00
Disabled       00 00 00 00
```

Initial UI support is limited to one non-modifier key plus zero to three left-side modifiers:

- Ctrl: `0xe0`
- Shift: `0xe1`
- Alt: `0xe2`
- Meta/Win/Command: `0xe3`

Canonical serialized order is Ctrl, Alt, Shift, Meta, then the non-modifier key. Decoding must preserve unknown usage values as hexadecimal rather than silently converting them to zero.

### 7.3 CRC

CRC is calculated over exactly the 45-byte page payload.

```text
width:       16
initial:     0xffff
polynomial:  0xa001, reflected
xorout:      0x0000
storage:     little-endian
```

The CRC of 45 zero bytes is `0xcf30`, stored as `30 cf`.

### 7.4 Read request

A read request is 62 bytes:

```text
04 02 00 00 00 2d 00 30 cf b4 00 00 00
<offset uint32 little-endian>
<45 zero bytes>
```

### 7.5 Read response

A configuration notification is 61 bytes:

```text
04 00 02 00 2d 00
<crc16 little-endian>
b4 00 00 00
<offset uint32 little-endian>
<45-byte payload>
```

Parser requirements:

- Require an exact 61-byte packet for this message type.
- Require prefix `04 00 02`.
- Require payload length `0x2d`.
- Require an expected offset.
- Validate CRC before accepting the page.
- Ignore unrelated notification types.
- Reject duplicate offsets with conflicting payloads.
- An identical duplicate may be ignored and logged without sensitive bytes.

### 7.6 Write page

A write page is 62 bytes:

| Bytes    | Meaning                           |
| -------- | --------------------------------- |
| `0`      | `0x04`                            |
| `1`      | `0x01`, configuration write       |
| `2..4`   | zero                              |
| `5`      | `0x2d`, payload length            |
| `6`      | zero                              |
| `7..8`   | CRC16, little-endian              |
| `9`      | `0xb4`                            |
| `10..12` | zero                              |
| `13..16` | page offset, uint32 little-endian |
| `17..61` | 45-byte payload                   |

### 7.7 Commit

After all four pages are written successfully, send:

```text
04 06 00 5b 00 00 00 ff ff 00 00 00 00 00 00 00 00
```

### 7.8 Initialization packets

The observed load flow contains `04 5a`, `04 0b`, and two `04 11` packets before page reads. Captured byte sequences may be transcribed into named constants with provenance tests, but their unknown fields must not be generalized or modified.

Use the following observed load preamble verbatim for the initial hardware implementation:

```text
04 5a 00 00 00 01 00 bf 40 01 00 00 00 00 00 00 00 00
04 0b 00 00 00 04 00 00 24 04 00 00 00 40 70 01 01 00 00 00 00
04 11 00 01 00 00 00 ff ff 00 00 00 00 00 00 00 00
04 11 00 00 00 00 00 ff ff 00 00 00 00 00 00 00 00
```

Give these constants semantic names such as `OBSERVED_LOAD_PREAMBLE_1` rather than invented names such as `AUTHENTICATE`, because their exact meaning is not established.

Observed save captures also contain `04 50` and `04 03` messages whose semantics are not decoded. The initial implementation follows the minimally demonstrated flow: initialize/read a fresh baseline, write four generated pages, commit, then perform a fresh full read. If real hardware testing shows another message is required, add it only with a captured before/after test vector and update this document.

## 8. Domain model

```ts
export type ButtonId =
  | "a"
  | "b"
  | "x"
  | "y"
  | "l"
  | "r"
  | "l2"
  | "r2"
  | "minus"
  | "plus"
  | "star"
  | "logo"
  | "up"
  | "down"
  | "left"
  | "right";

export interface HidChord {
  kind: "chord";
  modifiers: Array<"ctrl" | "alt" | "shift" | "meta">;
  key: number | null;
}

export interface UnknownHidMapping {
  kind: "unknown";
  raw: Uint8Array; // Owned copy of exactly four bytes.
}

export type DecodedMapping = HidChord | UnknownHidMapping;

export interface ParsedConfig {
  raw: Uint8Array;
  mappings: Record<ButtonId, DecodedMapping>;
  disableSleep: boolean | null;
}

export interface MappingDraft {
  baseline: ParsedConfig;
  mappings: Record<ButtonId, DecodedMapping>;
  disableSleep: boolean | null;
  dirtyButtons: Set<ButtonId>;
}
```

Unknown mappings retain their exact four bytes until explicitly replaced with a supported chord. Save applies only explicitly edited mappings; it never re-encodes untouched mappings.

`disableSleep: null` means the raw byte is not a confirmed `0x00`/`0x01`. The UI must disable editing in that state, and serialization must preserve the raw byte.

## 9. Application operations

### 9.1 Read

1. Confirm an active BLE connection and notifications.
2. Send the initialization/load sequence.
3. Send four read requests.
4. Collect four distinct CRC-valid response pages.
5. Assemble them by offset into 180 bytes.
6. Decode known fields and retain the raw payload.
7. Present mappings only after the full snapshot succeeds.

Partial data is diagnostic only and never becomes an editable baseline.

### 9.2 Save

1. Disable concurrent UI operations.
2. Perform a new full read; do not reuse the originally displayed baseline.
3. Encode every requested mapping before making any write.
4. Overlay only confirmed bytes on a copy of the new baseline.
5. Save the original baseline in IndexedDB and wait for the transaction to commit.
6. Show a confirmation summary derived from byte differences.
7. If confirmed, write all four generated pages and then commit.
8. Perform another full read.
9. Require valid CRCs for all pages and byte-for-byte equality at offsets 2–179. Accept device-updated bytes 0–1 and retain the full actual readback.
10. Report verified success or a verification failure with restore guidance.

If the newly read baseline differs from the baseline used to edit the screen, show that the device changed and require the user to review before writing.

### 9.3 Restore

1. Validate the backup schema and require exactly 180 decoded bytes.
2. Read a fresh current baseline and decode the selected backup.
3. Prepare edits only for backup mappings decoded as supported `HidChord` values. Skip unknown mappings and retain the current slot bytes. Restore Disable Sleep only when both backup and current bytes are confirmed `0x00`/`0x01` values.
4. Apply those edits to a copy of the current baseline. Preserve every other current byte, including unknown fields and skipped mappings.
5. Back up the current baseline as a new recovery point and await persistence.
6. Display the known-field differences and all skipped fields. Require explicit confirmation before any configuration-page write; cancellation sends no configuration pages or commit.
7. Write all four pages of the prepared payload and commit.
8. Reread all 180 bytes, validate page CRCs, and require equality at offsets 2–179 with the prepared payload, not the selected backup. Retain device-updated bytes 0–1.

Restore never writes the selected backup payload wholesale. Raw backups retain the original bytes for diagnosis, but the first release restores only supported known fields. The UI must explain this limitation before confirmation. Restore preparation and confirmation use the same connection-generation, stale-operation, and single-use safeguards as Save.

## 10. UI design

The first release has one primary screen:

- Browser compatibility notice.
- Connection card with device state and explicit Connect/Disconnect controls.
- Sixteen-button mapping grid grouped by physical location.
- Key/chord editor with keyboard capture and a searchable key picker.
- Disable Sleep control, enabled only for a confirmed raw value.
- Unsaved-change indicator.
- Read Again, Save to Device, Export Profile, Import Profile, and Restore Backup actions.
- Operation log containing timestamps and semantic events only. Do not log raw packet hex, addresses, or device names by default.

Before save, show:

- Each changed physical button.
- Previous decoded value and new decoded value.
- Disable Sleep change, if any.
- Confirmation that a local backup will be retained.

## 11. State machine

```text
unsupported
disconnected -> choosing -> connecting -> subscribing -> reading -> ready
ready -> confirming -> saving -> verifying -> ready
ready -> restoring -> verifying -> ready
any connected state -> disconnected
any operation -> error -> ready or disconnected
```

Only `ready` permits editing. Only one operation may be active. A disconnect invalidates all GATT handles and cancels the current operation.

## 12. Local persistence

### 12.1 Raw backup

```ts
interface RawBackupV1 {
  schema: "8bitdo-micro-raw-backup/v1";
  id: string;
  createdAt: string;
  reason: "pre-save" | "pre-restore" | "manual";
  payloadBase64: string;
}
```

Validation requires exact object keys, a valid timestamp, and a Base64 payload decoding to exactly 180 bytes. Do not include device names, addresses, or browser identifiers.

### 12.2 Named profile

Named profiles contain only the 16 known mappings, optional Disable Sleep preference, display name, schema, and timestamp. They must not contain the unknown bytes from the raw configuration.

Profiles can be exported as JSON. Imported JSON must pass strict Zod validation before it can change a draft.

## 13. Security and privacy

- Serve over HTTPS.
- Set `Permissions-Policy: bluetooth=(self)`.
- Use a restrictive CSP. If no Wasm is used, do not add `wasm-unsafe-eval`.
- Use `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri 'none'`.
- Do not use third-party analytics on the configurator screen.
- Do not send packet data to error-reporting services.
- All device access requires an explicit browser permission prompt.
- No backend is required for the first release.

## 14. Cloudflare deployment

The Worker serves built assets and security headers. Configure SPA fallback and route requests through the Worker first. The client bundle performs all BLE and configuration work.

The deployment must not claim support for non-Chromium browsers. The production page should include a short compatibility statement and a link to local backup/export instructions.

## 15. Verification boundary

Automated tests can prove encoding, parsing, CRC, byte preservation, state transitions, and error handling. They cannot prove compatibility with every Micro firmware or browser/OS Bluetooth stack.

Release status must distinguish:

- `unit verified`: golden vectors pass;
- `browser-flow verified`: fake-transport end-to-end tests pass;
- `hardware verified`: a real Micro successfully completes save and full readback;
- `official-app cross-checked`: the official mobile app independently displays the intended mapping.

Do not label a release hardware verified until the last two steps have been performed and recorded.

## 16. Protocol provenance

This design is based on independently reverse-engineered community sources, not an official 8BitDo protocol specification:

- [MicroKey Studio repository](https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper)
- [MicroKey Studio protocol notes](https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper/blob/main/docs/protocol-notes.md)
- [MicroKey Studio packet builder](https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper/blob/main/src/MicroKeyStudio.Protocol/Packets/MicroSavePacketBuilder.cs)
- [8bitult Rust implementation](https://github.com/Thoxy67/8bitult)
- [8BitDo Micro official support](https://support.8bitdo.com/ultimate/micro.html)
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)

The implementation must preserve attribution and must independently review the licensing status of any source before copying code. Protocol facts and clean-room reimplementation are preferred over copying implementation text.

## 17. Public test vectors

These sanitized vectors are sufficient to bootstrap parser tests. They contain no device address or user-defined profile name.

Zero-page response at offset `0x5a`:

```text
04 00 02 00 2d 00 30 cf b4 00 00 00 5a 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

Nonzero page response at offset `0x00`:

```text
04 00 02 00 2d 00 9d 95 b4 00 00 00 00 00 00 00
8c b8 00 00 11 09 20 20 11 09 20 20 28 00 00 00
2a 00 00 00 e0 1a 00 00 e0 e1 17 00 e0 00 00 00
e2 00 00 00 e0 06 00 00 e0 19 00 00 00
```

The nonzero vector decodes slots 3–10 as Enter, Backspace, Ctrl+W, Ctrl+Shift+T, Ctrl, Alt, Ctrl+C, and Ctrl+V. Treat earlier bytes as unknown configuration data and preserve them.

## Hardware observation update (2026-09-09)

The device updates global bytes 0–1 when committing a mapping. The meaning of these bytes is unknown. The outgoing payload still preserves them exactly. The post-save/restore verifier validates all four CRCs, compares every byte at offsets 2–179, and retains the actual returned header. Baseline/stale-device checks still compare all 180 bytes. This is a scoped exception to readback equality, not permission to ignore other unknown fields. See [the investigation](save-investigation.md).
