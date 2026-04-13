# Current Changes & Baseline Simplification Plan (2026-04-13)

## Background

Recent commits (`0456d3f`, `f6513eb`, `19bbede`) fixed multiple issues, but the root concern remains:

- The `current-changes` realtime view must not mix comparison semantics.
- Overwrite restore/revert should be treated as baseline rebuild events, not as special realtime diff algorithms.

This plan intentionally focuses on simplification and consistency, not adding more rescue branches.

## Goals

1. Keep realtime `current-changes` on one comparison path only.
2. Keep generation/cross-generation safeguards only in history replay/export paths.
3. Simplify restore record semantics to reduce misleading detail behavior.

## Non-Goals

1. No changes to restore preflight strategy selection (`auto/patch/overwrite` decision logic).
2. No schema migration and no storage key rename.
3. No rollback of generation boundary and marker infrastructure.

## Implementation Scope

### 1) Lock Realtime Path Semantics

- Confirm `history_html/history.js` realtime current-changes paths do not call generation-aware tree alignment.
- Keep `buildGenerationAwareCurrentChangesTrees` only for history replay/export.

Status:
- Already achieved by `19bbede`; keep as invariant.

### 2) Simplify Restore Note Semantics (UI)

- In `popup.js`, avoid forcing overwrite wording for non-merge restore notes.
- Make note text strategy-accurate or strategy-neutral:
  - `patch` -> patch wording
  - `overwrite` -> overwrite wording
  - `auto` -> neutral restore wording

Reason:
- Prevent record-note semantics from diverging from actual execution strategy.

### 3) Simplify Overwrite Restore Record Payload

- In `background.js` restore record adjustment path:
  - Keep snapshot + stats generation behavior.
  - Stop persisting `changeData` payload for `strategy=overwrite`.

Reason:
- Overwrite restore is baseline rebuild oriented.
- Reduces complexity and avoids downstream detail reconstruction ambiguity from synthetic overwrite change payloads.

## Validation Checklist

1. Realtime current-changes:
   - After overwrite restore/revert, only one move should not appear as full add/delete in realtime view.
2. Restore note:
   - `patch` restore note shows patch wording.
   - `auto` restore note does not hardcode overwrite wording.
3. History details fallback:
   - Overwrite restore record can still be opened.
   - When no persisted changeData exists, fallback comparison still works through existing logic.

## Risks

1. Overwrite restore history detail may rely more often on fallback compare path.
2. Existing users may notice note text changes for `auto` restore entries.

Mitigation:
- Keep generation/baseline integrity logic unchanged.
- Keep history replay/export cross-generation safeguard unchanged.

