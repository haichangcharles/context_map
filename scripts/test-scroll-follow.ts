import assert from 'node:assert/strict';
import { isNearBottom, shouldAutoScrollToLatest } from '../src/utils/scrollFollow';

const run = () => {
  assert.equal(
    isNearBottom({ scrollTop: 540, scrollHeight: 1000, clientHeight: 400 }, 80),
    true,
    'viewport close to the bottom should still count as near-bottom'
  );

  assert.equal(
    isNearBottom({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 }, 80),
    false,
    'viewport well above the bottom should not count as near-bottom'
  );

  assert.equal(
    shouldAutoScrollToLatest({
      isUserNearBottom: false,
      contextChanged: false,
      forceFollow: false,
    }),
    false,
    'reading older messages should disable passive auto-scroll'
  );

  assert.equal(
    shouldAutoScrollToLatest({
      isUserNearBottom: true,
      contextChanged: false,
      forceFollow: false,
    }),
    true,
    'users already near the bottom should continue following new messages'
  );

  assert.equal(
    shouldAutoScrollToLatest({
      isUserNearBottom: false,
      contextChanged: true,
      forceFollow: false,
    }),
    true,
    'switching conversation context should still jump to the latest visible message'
  );

  assert.equal(
    shouldAutoScrollToLatest({
      isUserNearBottom: false,
      contextChanged: false,
      forceFollow: true,
    }),
    true,
    'explicit follow requests should override the passive scroll guard'
  );

  console.log('Scroll follow tests passed.');
};

run();
