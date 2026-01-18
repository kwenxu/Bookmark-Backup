# Patch Merge (Git-like Restore) Plan

## Context / Goal

We currently have a "Patch Merge" restore mode in two places:

- `history_html/history.html` (local Chrome storage backup history UI)
  - code: `history_html/history.js` -> `executeMergeRestoreToSnapshot()`
- main UI "Settings & Initialization" -> restore from WebDAV/GitHub/Local
  - code: `background.js` -> `executePatchBookmarkRestore()`
  - UI: `popup.js` restore modal

The goal of this plan is to make Patch Merge behave more like a mature Git restore:

- Git concept mapping
  - Commit = a backup record (history item)
  - Tree = bookmark tree snapshot at that record
  - Object id = stable content id (content-addressed identity), not runtime bookmark id
  - Checkout/reset = restore current working tree to a chosen commit
- Product goals
  - Restore to target version with minimal destructive operations
  - Preserve existing Chrome bookmark IDs as much as possible (keep ID-based data)
  - Be deterministic and stable under duplicates (same title/url)
  - Provide an "apply plan" (operations list) and execute in safe order

## Why current Patch Merge is not "Git-like" enough

Current implementation is still mostly "ID-based patch":

- It relies heavily on matching `node.id` between current and target.
- When IDs do not match (different device / HTML import / recreated nodes), we fall back to a heuristic ID normalization (`normalizeTreeIds`), but it does not behave like Git's content-addressed object model.

In Git, objects are content-addressed: the same content can be found across commits even if paths change, and patch application uses context to locate changes.

For bookmarks, we need a similar stable identity layer.

## Key Design: Stable "Object Id" for Bookmark Nodes

We introduce an internal concept: `oid` (object id) per node.

- Bookmark oid: hash of `(type='B', url, normalizedTitle)`
- Folder oid: hash of `(type='F', normalizedTitle, structureSignature)`
  - `structureSignature` is a small signature to disambiguate same-title folders:
    - example: direct child counts + a short hash of top-k child oids

We also compute additional metadata for patch application:

- `pathHint`: the folder path from root (titles only)
- `siblingHint`: neighbor oids around the node within its parent

This is the bookmark-world equivalent of Git's "blob id + tree path + patch context".

## Phase A: History HTML Patch Merge (Local storage restore)

Target file: `history_html/history.js`

### A1) Build "Git Index"-like structures

For both current tree and target tree build:

- `nodeIndexById` (existing)
- `nodeIndexByOid`: `oid -> [candidateNodes]` (multi-map)
- `nodeIndexByPath`: `pathString -> [candidateNodes]`

Also build a `workIndex` for current tree that allows fast operations:

- `id -> { parentId, index, title, url, oid, path }`
- `parentId -> ordered child ids`

### A2) Resolve identity mapping (target -> current)

We create a mapping `resolveTargetRef(targetNode) => currentNodeId | null`.

Order of matching (best-first, stop when unique match found):

1) Exact id match (current has same id, same type)
2) Oid match with strong context
   - same parent oid OR same parent path
   - and sibling context similarity
3) Oid match without context (only if unique)
4) Path-based match (rare fallback)

If still ambiguous, mark as conflict and do not auto-delete/move that node; only create missing items.

This is similar to Git's rename detection / fuzzy matching.

### A3) Compute an explicit operation plan (the "patch")

Instead of directly collecting `addedIds/movedIds/...` by id only, we compute operations on the matched identity layer.

Operations:

- `createFolder/createBookmark`
- `move`
- `update` (title/url)
- `deleteTree`

Rules:

- Do NOT operate on system roots (`Bookmarks Bar`, `Other Bookmarks`)
- Conflicts:
  - if match ambiguous -> skip destructive ops (no delete, no move), only allow creates

### A4) Apply patch in Git-safe order

Git applies changes while trying to avoid breaking later hunks; for bookmarks we apply:

1) Create folders (parents first)
2) Create bookmarks (can be done after folders)
3) Move (parent first; within parent sort by target index)
4) Update
5) Delete (top-level deletes only; folders last)

Important detail: moving affects indices.

- For each parent, apply reordering using a stable two-pass approach:
  - pass 1: move items that change parent
  - pass 2: within each parent, reorder by performing minimal moves to reach target sequence

### A5) Verification and "Working tree" reconciliation

After execution:

- Re-fetch `browser.bookmarks.getTree()`
- Verify that for every matched target node, its current `title/url/parent` matches target
- Report a detailed result:
  - counts, conflicts, skipped ops

### A6) UX for history.html

- Add a "Dry run" mode (optional): show planned operations before executing.
- Keep existing progress UI.

Deliverables for Phase A:

- new shared helpers inside `history_html/history.js`:
  - `computeNodeOid()`
  - `buildPatchIndex()`
  - `planPatchOperations()`
  - `applyPatchOperations()`

## Phase B: Main UI Patch Merge (Restore from WebDAV/GitHub/Local)

Target file: `background.js`

### B1) Unify patch engine between background and history.html

We should avoid two independent patch implementations.

Option 1 (recommended): extract core patch functions into a shared module under `utils/` (MV3-safe, ES module), and import from:

- `background.js`
- `history_html/history.js`

Option 2: keep duplicated code but keep logic identical (higher maintenance).

### B2) Apply same "oid + context" identity mapping

Even for cloud JSON/ZIP restore, IDs may not match current browser (different device), so relying on `normalizeTreeIds` is not enough.

Implement the same identity resolver as Phase A.

### B3) Strategy availability

Currently `popup.js` disables Patch Merge for snapshot HTML backups.

- Keep this restriction for now (Phase B focuses on backup-history JSON/ZIP)
- After Phase B stabilizes, we can optionally support Patch Merge for HTML snapshots by:
  - parsing HTML to tree
  - computing oids
  - using the same patch engine (but with 0% id matches)

### B4) "Git database" thinking for backup history restore

Remote sources provide a set of records (like commits):

- ZIP: many JSON records (commit objects)
- merged JSON: array/records

We already parse these into restore versions.

Enhancement:

- Use `seqNumber/time` ordering to compute parent relationships
- (Optional) For future: store parent pointer in exported record metadata

This allows future three-way merge if we want a true "merge" (not just reset).

### B5) Testing / Validation checklist

We need deterministic cases:

- Simple add
- Simple delete
- Move across folders
- Rename title
- Duplicate URLs in multiple folders
- Duplicate folder names at different levels
- Move + rename in one step
- Large tree performance (~5k+ bookmarks)

Manual verification steps:

- Before/after tree diff using existing `detectTreeChangesFast` tooling
- Ensure ID-based data (records/recommendations) still work after patch merge

## Proposed Implementation Order

1) Phase A: implement oid + planning engine in `history_html/history.js`, behind Patch Merge
2) Extract shared core to `utils/patch-merge-core.js` and wire Phase A to use it
3) Phase B: update `background.js executePatchBookmarkRestore()` to use the shared core
4) Optional: enable Patch Merge for snapshot HTML restore in `popup.js` when core is stable

## Notes / References

- Git internals: object database is content-addressed; files are blobs, directories are trees, commits point to trees.
  - https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
- Git reset/checkout mental model: HEAD/index/workdir "three trees".
  - https://git-scm.com/book/en/v2/Git-Tools-Reset-Demystified

- Related repo commits (context):
  - `46ca71c0549698a68ebdfd0637dcb9658a99874e`
  - `18079567e9493507ed168a625cb2c741f17bc652`
