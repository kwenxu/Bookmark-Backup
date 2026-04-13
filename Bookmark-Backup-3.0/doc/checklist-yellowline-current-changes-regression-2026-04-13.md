# Yellow-Line & Current Changes Regression Checklist (2026-04-13)

## Purpose

Validate that realtime `current-changes` keeps a single comparison semantics after overwrite restore/revert (yellow-line boundary), and does not regress to mixed comparison paths.

## Preconditions

1. Start from a non-empty bookmark tree.
2. Ensure at least one successful baseline backup exists.
3. Open both:
   - Popup history list
   - `history.html` current-changes view

## Scenario A: Overwrite Rebuild Then Minimal Move

1. Run overwrite restore (or overwrite revert) to create a yellow-line boundary.
2. After completion, perform only one move operation (move one bookmark or folder).
3. Open current-changes.

Expected:

1. Change summary should show one move (or equivalent minimal structural change).
2. Must not show full-tree add/delete explosion.
3. No mismatch between summary cards and tree highlight markers.

## Scenario B: Yellow-Line + 1st / 2nd / 3rd Changes

1. After yellow-line boundary:
   - First change: move one node.
   - Second change: modify title/url of one bookmark.
   - Third change: add one bookmark.
2. After each step, refresh current-changes and inspect.

Expected:

1. All three rounds use the same realtime comparison semantics.
2. No “first change special algorithm” behavior.
3. Counts remain stable and local to actual operations.

## Scenario C: Clear History Then Continue

1. Create yellow-line boundary.
2. Clear history records (keep current bookmarks).
3. Perform one additional small change.
4. Open current-changes and history list.

Expected:

1. No crash and no comparison-path fallback loops.
2. Current-changes still shows only real delta against current baseline snapshot.
3. Marker fallback UI does not break list rendering.

## Scenario D: Delete Marker Record (Yellow-Line Record Removed)

1. Create yellow-line boundary and several subsequent records.
2. Delete the boundary record itself from history list.
3. Compare adjacent records before/after the deleted boundary position.

Expected:

1. History replay/export compare remains valid (cross-generation fallback still works where needed).
2. UI marker may disappear, but data comparison must remain correct.

## Scenario E: Restore/Revert Display Note Semantics

1. Execute restore under three strategy outcomes (`patch`, `overwrite`, `auto`).
2. Check history list note text.

Expected:

1. `patch` shows patch wording.
2. `overwrite` shows overwrite wording.
3. `auto` does not hardcode overwrite wording; display remains strategy-accurate or neutral.

## Quick Pass/Fail Rule

Fail immediately if any one of the following appears:

1. Single move operation renders as full add/delete after yellow-line boundary.
2. First post-yellow-line operation uses different compare semantics than later operations.
3. Realtime view and detail/export views disagree on basic change direction (add/delete/move/modify).

