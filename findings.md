# Findings

- `src/components/ConversationStream.tsx` contains an unconditional auto-scroll effect:
  - `endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });`
  - dependency array: `[nodes, context?.base_path]`
- Because `nodes` is a large object that is replaced on every `addNode` and every `updateNodeContent`, the effect runs for:
  - sending a new user message
  - creating the empty assistant placeholder
  - every streamed assistant token append
  - switching branch / mainline context
- The messages container (`<div className="flex-1 overflow-y-auto ...">`) has no tracked `onScroll` state and no "user is reading older messages" guard.
- Result: if the user scrolls upward while a response is streaming or whenever `nodes` changes, the component will keep pulling the viewport back toward the bottom.
- There is a second `scrollIntoView` path for the custom `locate-node` event, but that one is explicit and not the cause of passive jump-to-latest behavior.
- The fix is to gate passive auto-scroll behind a near-bottom check and allow explicit overrides only for user-initiated follow actions such as sending a new message or changing conversation context.
