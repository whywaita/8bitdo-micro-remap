# Hardware verification record

Status: **Partial investigation performed**. On 2026-09-09, a diagnostic BLE client saved a single A mapping and the user confirmed A in the official app. Device-generated changes at offsets 0–1 explained the web verifier failure. The updated web workflow, full restoration procedure, deployment, and platform coverage remain unverified; this is not a release-wide hardware pass. See [the investigation](save-investigation.md).

## Environment

| Field                  | Recorded value |
| ---------------------- | -------------- |
| Deployed HTTPS URL     | Pending        |
| Application commit     | Pending        |
| Browser and version    | Pending        |
| OS and version         | Pending        |
| Micro firmware version | Pending        |
| Official app version   | Pending        |
| Test date              | Pending        |

Do not record Bluetooth addresses, advertising names, packet dumps, raw configuration bytes, or backup contents here.

## Procedure and evidence

Use a Micro recoverable through the official mobile app. Record its original mapping privately before starting. Choose a harmless mapping such as assigning Enter to A in a blank text editor. Review any existing local backups.

| Step                                                                          | Result  |
| ----------------------------------------------------------------------------- | ------- |
| Put the Micro in K mode and connect from HTTPS                                | Pending |
| Confirm filtered chooser cancellation is nonfatal                             | Pending |
| Confirm subscription and four CRC-valid pages                                 | Pending |
| Save one harmless mapping with a persisted backup                             | Pending |
| Confirm full 180-byte exact readback                                          | Pending |
| Disconnect the browser and independently inspect mapping in official app      | Pending |
| Reconnect and restore the pre-save backup's supported fields                  | Pending |
| Confirm exact prepared-payload readback and current unknown-byte preservation | Pending |
| Disconnect and independently confirm restoration in official app              | Pending |
| Confirm physical disconnect updates UI immediately                            | Pending |
| Repeat on a second Chromium/OS combination if available                       | Pending |

If a step fails, record only the semantic error, preserve backups, and mark the hardware run failed. Never relax CRC, byte preservation, confirmation, or readback checks to obtain a passing result.
