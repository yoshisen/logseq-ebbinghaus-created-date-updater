# Ebbinghaus Created Date Updater v0.1.11

## New: RANGE start/end in Settings
In plugin settings, set:
- `RANGE start (YYYYMMDD)`
- `RANGE end (YYYYMMDD)`

Then `/Ebbinghaus: Insert created query (RANGE)` will insert a query using:
`RANGE:<start>-<end>`.

### Fallback behavior
For RANGE updates:
1. If the page contains a local sentinel like `RANGE:20260101-20260102`, use it.
2. Otherwise, fallback to the Settings rangeStart/rangeEnd (if valid).

Offsets (`@ebbinghaus-created`) stay template-only.
RANGE (`@ebbinghaus-range`) works on any page.
