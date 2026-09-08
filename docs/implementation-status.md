# Implementation verification ledger

Scope: all first-release features and safety requirements in `design.md` and `impl.md`, including the UI states illustrated in `wireframe/`. Deferred work in implementation-plan section 16 remains outside the first release.

The implementation and automated checks are present. **The release is not complete:** production deployment and real-device/official-app verification are outstanding.

## Requirement evidence

| Requirement / gate                                                                      | Implementation and evidence                                                                                       | Status                                                 |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| React, strict TypeScript, Node LTS, pnpm lockfile                                       | package.json, tsconfig.json, pnpm-lock.yaml; frozen-lockfile installation tested                                  | Implemented                                            |
| Cloudflare Vite development and build                                                   | vite.config.ts, wrangler.jsonc; development browser smoke test with zero page/console errors                      | Passed locally                                         |
| 16 unique button slots and exact byte offsets                                           | src/protocol/buttons.ts; protocol.test.ts                                                                         | Passed                                                 |
| CRC-16 reflected 0xa001, empty/zero/nonzero vectors                                     | crc16.ts; public observed nonzero vectors linked in protocol.test.ts                                              | Passed; 100% CRC branch coverage                       |
| Read/write packet shapes, all offsets, commit and initialization literals               | packets.ts, initialization.ts; complete golden arrays, invalid header/length/offset/CRC tests                     | Passed; 100% packet branch coverage                    |
| HID keys/chords, disabled values, unknown raw representation                            | hid-codec.ts, types.ts; codec tests, editor component tests                                                       | Passed                                                 |
| Owned buffers, four-page assembly, conflicting duplicates, byte-preserving edits        | config.ts; deterministic multiple-baseline preservation tests and duplicate tests                                 | Passed                                                 |
| Protocol module independence from DOM, transport, persistence, UI                       | architecture.test.ts parses imports and checks browser API references                                             | Passed                                                 |
| FIFO GATT queue and disconnect cancellation                                             | command-queue.ts; ordering, rejected operation, cancellation tests                                                | Passed                                                 |
| Notification copies, cleanup, async stream                                              | notification-stream.ts, web-bluetooth-transport.ts; owned DataView tests and waiter cleanup                       | Passed                                                 |
| Chooser gesture, filters, exact UUIDs, subscription, reconnect handles                  | web-bluetooth-transport.test.ts with browser API doubles                                                          | Automated checks passed; actual chooser/device pending |
| Complete fresh reads and no partial editable baseline                                   | controller-service.test.ts timeout, incomplete page, CRC and conflicting response cases                           | Passed                                                 |
| Backup before configuration writes, no writes on backup failure                         | controller-service.test.ts and browser E2E backup-before-write assertion                                          | Passed                                                 |
| Prepare/confirm split; single-use, time-limited, connection-bound tokens                | service tests for cancel, expiration, reconnect, reuse, simultaneous attempts, deleted backup                     | Passed                                                 |
| Device-changed detection and byte-diff confirmation                                     | service DEVICE_CHANGED test; UI and E2E confirmation tests                                                        | Passed                                                 |
| Four page writes then commit, no commit after failed page, bounded acknowledgement wait | service tests for each page, commit failure, missing acknowledgements and disconnect                              | Passed                                                 |
| All-page CRC and bytes 2–179 verification before success                                | service/E2E mismatch at known and unknown offsets, invalid CRC, incomplete read, disconnect                       | Passed against fake device                             |
| Restore current backup, confirmation, supported-field overlay, skipped fields           | service restore tests; UI confirmation test; E2E restores while retaining current unknown byte                    | Passed against fake device                             |
| Backup schema, timestamps, Base64 validation, local ordering and deletion               | storage.test.ts with fake IndexedDB; corrupt entries remain stored without hiding valid recovery points           | Passed                                                 |
| Strict named profiles, deterministic export, local persistence and draft-only import    | storage and UI tests; browser JSON download/upload roundtrip and no-write assertion                               | Passed                                                 |
| All error codes, support checks, cancellation, recovery guidance                        | errors.ts, App.tsx; service/transport/component tests; static atlas tests cover documented error taxonomy         | Implemented and tested at respective layers            |
| Mapping editor, searchable picker, keyboard capture, Escape, unsupported modifiers      | MappingEditor.tsx; component tests and browser keyboard tests                                                     | Passed                                                 |
| Dirty-state handling, unchanged edits, discard and disconnect confirmations             | App.tsx; unchanged/cancel tests and E2E disabled-save assertions                                                  | Passed                                                 |
| Empty/invalid backup and profile states, visible modal errors                           | App.tsx; storage and UI regression tests                                                                          | Passed                                                 |
| Semantic operation log and development-only packet-length diagnostics                   | operation-state.ts, ControllerService.read, App log panel; no raw packet/device identity fields                   | Implemented                                            |
| Keyboard navigation, focus containment, visible focus, aria-live, 320px layout          | Modal.tsx, styles.css; keyboard and 320px E2E tests; desktop/mobile screenshots visually inspected                | Passed locally                                         |
| Worker assets, SPA nested-route fallback, security headers, build-only health response  | worker.test.ts and nested-route browser test                                                                      | Passed locally                                         |
| Production CSP excludes inline/eval allowances; dev refresh is usable                   | worker.ts development-only policy; production E2E header assertion; dev console checked                           | Passed                                                 |
| No normal client requests outside same origin                                           | browser request-observation E2E                                                                                   | Passed                                                 |
| Test device excluded from production assets                                             | scripts/verify-production.mjs run by pnpm build                                                                   | Passed                                                 |
| Formatter, ESLint, TypeScript, protocol coverage, wireframe tests                       | package scripts and local command results                                                                         | Passed                                                 |
| CI actionlint job and SHA-pinned actions                                                | .github/workflows/ci.yml; actionlint and pinact run -u                                                            | Passed locally; no remote CI run claimed               |
| Production build and Worker deployment dry run                                          | pnpm deploy:check                                                                                                 | Passed; no deployment performed                        |
| Limitations, platforms, recovery, provenance, verification levels                       | README.md and hardware-verification.md                                                                            | Documented                                             |
| Actual HTTPS origin and headers                                                         | Requires Cloudflare authentication and intended account                                                           | Pending                                                |
| Real Micro save/restore and official-app cross-check                                    | hardware-verification.md records a partial single-button investigation; full release verification remains pending | Pending                                                |

## Automated run record

Local environment: Node.js 24.15.0, pnpm 10.33.2, macOS. Dependency versions are pinned by the lockfile.

- Unit/component/Worker/architecture suite: 295 tests.
- CRC and packet validation: 100% branch coverage (enforced thresholds).
- Playwright suite: 13 scenarios. The twelve implementation-plan flows are covered across these scenarios; save/backup ordering/reload/restore are combined in one end-to-end case.
- Static wireframe suite: 3 tests.
- Production artifact exclusion check: 1 test.
- TypeScript, ESLint, formatting, actionlint, and deployment dry run: passed locally.

These results prove behavior against protocol vectors, browser API doubles, a scripted transport, and local Worker execution. They do not prove firmware interoperability or deployment availability.

## Remaining external evidence

1. `wrangler whoami` reported an expired token that could not be refreshed noninteractively. Authenticate with `pnpm exec wrangler login`, identify the intended Cloudflare account, then deploy and verify the HTTPS origin.
2. A real Micro and official mobile app are needed for the manual procedure. Record browser, OS, firmware, app version, application commit, and semantic results in hardware-verification.md.
3. No GitHub remote is configured. The workflow is validated locally; remote CI has not run.

## Implementation decisions

- Raw restoration never overwrites the entire selected backup. It overlays supported known fields onto a fresh current snapshot, preserving current unknown bytes.
- The read timeout also bounds individual configuration-write and commit acknowledgements. On expiry the connection is closed and success is not reported.
- Production Worker observability is disabled to avoid default request logging. Local Vite development permits inline refresh scripts/styles; production does not.
- Corrupt local backups are retained and counted; valid recovery points remain accessible. Corrupt saved profiles do not prevent importing a new profile file.

## Post-investigation update

The post-save/restore verifier accepts device-updated bytes 0–1 and retains the complete actual readback, while validating all four CRCs and requiring all other 178 bytes to match. Outgoing payload preservation and full-byte stale-baseline checks are unchanged. A single-button diagnostic save was confirmed in the official app; broad hardware and web workflow verification remain pending. See save-investigation.md.
