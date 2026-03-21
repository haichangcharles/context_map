import assert from 'node:assert/strict';
import { createChildTimestampAfter } from '../src/utils/messageTimestamp';

const run = () => {
  const parentTimestamp = '2026-03-21T10:00:00.123Z';

  const childAtSameInstant = createChildTimestampAfter(parentTimestamp, parentTimestamp);
  assert.equal(
    childAtSameInstant,
    '2026-03-21T10:00:00.124Z',
    'child timestamp should move forward by 1ms when parent and child start at the same instant'
  );

  const childAlreadyLater = createChildTimestampAfter(parentTimestamp, '2026-03-21T10:00:00.130Z');
  assert.equal(
    childAlreadyLater,
    '2026-03-21T10:00:00.130Z',
    'child timestamp should stay unchanged when it is already later than the parent'
  );

  console.log('Message timestamp ordering tests passed.');
};

run();
