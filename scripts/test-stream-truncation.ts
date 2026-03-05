import assert from 'node:assert/strict';
import { appendDeltaWithinLimit } from '../src/services/streamLimit';

const run = () => {
  const base = appendDeltaWithinLimit('', 'hello', 10);
  assert.equal(base.acceptedDelta, 'hello');
  assert.equal(base.nextText, 'hello');
  assert.equal(base.truncated, false);

  const partial = appendDeltaWithinLimit('12345678', 'abcdef', 10);
  assert.equal(partial.acceptedDelta, 'ab');
  assert.equal(partial.nextText, '12345678ab');
  assert.equal(partial.truncated, true);

  const none = appendDeltaWithinLimit('1234567890', 'abcdef', 10);
  assert.equal(none.acceptedDelta, '');
  assert.equal(none.nextText, '1234567890');
  assert.equal(none.truncated, true);

  console.log('Stream truncation tests passed.');
};

run();
