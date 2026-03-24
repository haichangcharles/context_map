# Progress

- Loaded the required process skills and set the terminal title for this debugging task.
- Located the conversation scroll implementation in `src/components/ConversationStream.tsx`.
- Confirmed that the auto-scroll effect depends on the full `nodes` object and therefore re-runs on every streamed assistant content update.
- Confirmed there is no scroll-position guard, so user-initiated upward scrolling is not respected during ongoing updates.
- Added `scripts/test-scroll-follow.ts` to lock the expected behavior: passive auto-scroll must stop while the user is reading older messages.
- Added `src/utils/scrollFollow.ts` and updated `src/components/ConversationStream.tsx` to auto-follow only when the user is already near the bottom, while still allowing explicit jumps for send/context-switch actions.
- Verified with `npx tsx scripts/test-scroll-follow.ts` and `npm run lint`.
