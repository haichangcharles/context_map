# Delete Thread Nodes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a delete workflow to the context map that reuses selection mode, previews the structural result, requires explicit confirmation, preserves descendants when deleting interior segments, and supports undo.

**Architecture:** Implement deletion as a store-level structural rewrite so preview and commit share the same graph transformation rules. The UI will switch from the current `Fit` affordance to delete mode, color selected nodes with destructive styling, show a focused preview of the impacted subgraph, and call the delete action only after confirmation.

**Tech Stack:** React 19, Zustand, React Flow, TypeScript, scripted `tsx` tests

### Task 1: Capture delete semantics in scripted tests

**Files:**
- Create: `scripts/test-delete-selected-nodes.ts`
- Modify: `package.json`
- Test: `scripts/test-delete-selected-nodes.ts`

**Step 1: Write the failing test**

Add cases for:
- deleting a tail segment removes it cleanly
- deleting a middle segment reparents the remaining tail to the prior node
- deleting an anchor/splice segment inserts a placeholder and keeps surviving descendants connected

**Step 2: Run test to verify it fails**

Run: `npm run test:delete-selection`
Expected: FAIL because delete preview/action do not exist yet

**Step 3: Write minimal implementation**

Expose a preview helper and a committed delete action from `src/store.ts` so the test can exercise the structural rewrite directly.

**Step 4: Run test to verify it passes**

Run: `npm run test:delete-selection`
Expected: PASS

### Task 2: Implement store-level delete preview and commit

**Files:**
- Modify: `src/store.ts`
- Modify: `src/types.ts`

**Step 1: Add state/API surface**

Introduce types for delete preview metadata and add:
- a pure helper that derives the post-delete structure
- a `deleteSelectedNodes(projectId, nodeIds)` action that snapshots history and applies that structure

**Step 2: Encode graph rewrite rules**

Rules:
- If a selected node has no surviving child, delete it normally.
- If a selected node is in the middle of a chain, reconnect the surviving child chain to the nearest surviving parent.
- If the deleted segment owns surviving children from multiple outgoing paths or is a branch anchor, insert a placeholder node and connect survivors to it.

**Step 3: Keep contexts and branches valid**

Clean deleted node ids out of context include/exclude lists, move invalid active contexts back to `mainline`, and re-anchor or synthesize branch placeholders where necessary.

**Step 4: Verify**

Run: `npm run test:delete-selection`

### Task 3: Replace fit with destructive selection UI

**Files:**
- Modify: `src/components/ContextMap.tsx`

**Step 1: Reuse selection mode**

Swap the `Fit` control for `Delete`. In delete mode, selected nodes should use a red destructive border instead of the current sky selection highlight.

**Step 2: Add preview + confirmation**

Show a focused destructive notice/card that:
- summarizes how many nodes will be deleted
- explains when a placeholder will be inserted
- renders a small simulated map preview of the affected segment
- requires an explicit confirm click before calling the store action

**Step 3: Preserve undo**

After deletion, exit delete mode and surface a notice that the change can be reversed with undo.

**Step 4: Verify**

Run the app manually if needed and confirm selection, preview, confirm, and undo behavior.

### Task 4: Regression checks

**Files:**
- Modify: `progress.md`
- Modify: `findings.md`

**Step 1: Run targeted checks**

Run:
- `npm run test:delete-selection`
- `npm run test:mainline`
- `npm run lint`

**Step 2: Record outcomes**

Log RED/GREEN evidence and any remaining caveats around placeholders or preview scope.
