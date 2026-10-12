# Contextify technical architecture

Contextify is a long-horizon chat interface. A turn uses a **Context Plan**, not the entire chronological transcript. The plan names one active path and explicit node-level includes and excludes. An older branch can become relevant many turns later without becoming the current branch.

## The turn flow

1. The graph layer builds project-local message, parent, branch-membership and branch-anchor relationships. It indexes message terms once per graph revision.
2. While the user drafts a turn, the context steward looks for relevant messages in other branches. It ranks candidates using query coverage and branch intent, then adjusts its suggestion threshold from that user's confirmed choices and manual plan edits. The agent returns a proposal with exact message IDs and a fingerprint of the plan it inspected.
3. The UI shows the proposed messages and waits for Include or Skip. On Include, a fresh graph and plan are checked against the fingerprint before the existing store action writes an explicit include. An explicit exclude always wins. Skip records negative preference evidence. Imported branch chips let the user return a group to its natural inactive state in one action. These actions do not change the base path by themselves.
4. The context compiler produces the ordered, deduplicated node list sent with the next chat request: active-path nodes plus explicit includes, minus explicit excludes. The same selection and plan snapshot are recorded under the user and turn node IDs before the reply starts.
5. The existing structure suggestion agent can recommend opening a branch, returning to a parent, or extracting a reusable pattern. Its read set is a bounded recent tail plus explicit includes, and its output budget is capped. The user can continue to make all structure and context edits manually.

`src/domain/contextSteward.ts` contains the pure graph, ranking, review and compilation rules. `src/services/contextPreferenceStore.ts` and `src/utils/contextPlanEditLog.ts` persist local evidence. `src/store.ts` owns accepted Context Plan mutations. `src/components/ConversationStream.tsx` presents proposals and sends compiled turns. This separation lets a different agent policy rank candidates without changing what Include, Exclude, or send mean.

## State and lifecycle

`base_path` selects the active conversational route. `included_nodes` temporarily imports material from elsewhere in the project; `excluded_nodes` removes material from the next request. Branch records preserve anchors and parent-branch lineage, while `status` distinguishes active and inactive branches. Every sent turn records the plan and selected node IDs so an earlier decision can be inspected even after the current plan changes.

## Scope of the current implementation

The local steward is a training-free, review-first policy. Its learned profile is a small calibration from accepted/rejected proposals and manual include/exclude counts. It is useful as a reproducible baseline, not a claim that user intent or personalization quality has been established. Evidence is local to the browser for now; cross-device sync and richer preference inference remain open engineering work.

The standalone app still calls its server-side OpenAI-compatible model proxy for chat and model-backed structure suggestions. The [DeepSeek Harness Contextify companion](https://github.com/haichangcharles/dsh-context-map) implements the durable agent loop and Context Plan service separately. Connecting this UI to that runtime is a distinct integration step; this document does not imply they already share live state.

## Verification

`npm run test:context-steward` checks long-horizon branch return, irrelevant-branch rejection, include/exclude precedence, stale-proposal rejection and preference updates. `npm run test:context-plan-edit-log` checks edit evidence. `npm run lint` and `npm run build` verify the standalone app. No paid model API call is required for these checks.
