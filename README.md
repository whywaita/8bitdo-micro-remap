# 8BitDo Micro Remap

An unofficial, local-first keyboard configurator for the 8BitDo Micro. The React application communicates with the controller directly through Web Bluetooth; the Cloudflare Worker serves assets and security headers only.

## Run locally

Use Node.js 24 LTS and pnpm 10.33.2.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed localhost URL in Chrome or Edge. Production requires HTTPS. Windows, macOS, ChromeOS, and Android with Web Bluetooth support are the initial targets. Safari and Firefox are unsupported. Put the Micro in **K mode** and disconnect other configuration apps before selecting it in the browser chooser.

`docs/wireframe/index.html` is the static screen atlas. It can be opened directly and does not communicate with hardware.

## Configure

1. Connect and wait for a complete, CRC-validated read.
2. Select a physical button. Choose a key and up to three left-side modifiers, or capture a physical keyboard chord. Escape is a valid mapping. Capturing a normal key completes capture; releasing a modifier completes a modifier-only capture.
3. Apply to the local draft. Nothing has been written yet.
4. Choose **デバイスに保存**. The app rereads the device, rejects changes since editing started, and persists a recovery backup.
5. Review the changes and confirm. The app sends four pages, commits, rereads every page, and reports **Verified** only when all four page CRCs validate and bytes 2–179 match. Device-updated bytes 0–1 are retained from readback; their meaning is still unknown.

Unknown mappings display as hexadecimal and remain untouched unless explicitly replaced. Unrecognized sleep values cannot be edited. Mouse actions, media keys, macros, S/D mode, USB configuration, and firmware updates are outside the first release.

## Backups and recovery

Backups are retained in this browser's IndexedDB until explicitly deleted. Clearing site data or using another browser loses access to them. A failed backup prevents configuration writes. A failed transfer prevents the commit command; a failed commit or readback is never reported as success.

If an operation fails, retain the backups, check power and K mode, reconnect, and reread. Select a backup if restoration is needed. Restoration first backs up the current configuration, then asks for confirmation. It restores **supported known fields only**, preserves the current unknown bytes, and lists skipped fields. It does not overwrite the full device payload from an older backup. Verification compares against the prepared overlay.

If recovery fails, disconnect the browser and inspect the controller in the official mobile app. A single-button save was checked on the investigation device and confirmed in the official app; restoration and broader hardware interoperability remain unverified; see [the verification record](docs/hardware-verification.md).

## Profiles

Export creates a named JSON file from the draft and retains the profile locally. Profiles contain all sixteen supported mappings and an optional confirmed sleep preference, without device identity or unknown raw fields. Export is rejected if a mapping is unsupported. Import validates the complete document and asks before replacing the draft; it never writes directly to the controller. Saved profiles can also be selected locally.

## Verification

```sh
pnpm format:check
pnpm lint
pnpm test:coverage
pnpm test:wireframe
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm deploy:check
```

E2E tests build in `e2e` mode and inject a scripted transport. They exercise the real application service, IndexedDB, and Worker. They do not automate the native Bluetooth chooser. A normal production build excludes the scripted device and its test hooks. E2E builds must never be deployed; `pnpm deploy` always creates a fresh production build.

The CI workflow also runs `actionlint`; all action references are SHA-pinned. No automated dependency update workflow is enabled before hardware verification.

For semantic diagnostic information, run `VITE_DIAGNOSTICS=true pnpm dev` and open the operation log. This shows the phase, page count, and last notification length without raw packets, device names, or addresses.

## Deploy

```sh
pnpm exec wrangler login
pnpm deploy:check
pnpm deploy
```

The Worker name is `8bitdo-micro-remap` in `wrangler.jsonc`. Configure the intended Cloudflare account before publishing. There are no database bindings, secrets, accounts, analytics, or synchronization services. Worker observability is disabled to avoid default request logging. Runtime device data stays in the browser. Production CSP allows only same-origin assets/connections, prevents framing, and grants Bluetooth to the same origin.

Actual deployment and real-device verification are outstanding. Automated coverage, browser flows, and a dry run are not hardware or official-app verification. The [implementation ledger](docs/implementation-status.md) records the completion boundary.

## Protocol provenance

The implementation is independently written from protocol facts in [the design](docs/design.md), the USB HID Keyboard/Keypad usage table, and public sanitized observations:

- [MicroKey Studio protocol notes](https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper/blob/main/docs/protocol-notes.md)
- [Public observed CRC vectors](https://github.com/WhiteCAN/8bitdo-micro-windows-keymapper/blob/main/tests/MicroKeyStudio.Protocol.Tests/MicroCrc16Tests.cs)
- [8bitult](https://github.com/Thoxy67/8bitult)
- [USB HID Usage Tables 1.6](https://www.usb.org/sites/default/files/hut1_6.pdf)
- [Official Micro support and visual reference](https://support.8bitdo.com/ultimate/micro.html)

No community implementation code or official logos/images were copied. Unknown initialization bytes are reproduced only as documented observations and are not interpreted or generalized.
