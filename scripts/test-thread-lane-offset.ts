import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ContextMap.tsx', import.meta.url), 'utf8');

const timelineStart = source.indexOf("if (mode === 'timeline')");
const timelineEnd = source.indexOf('  } else {', timelineStart);

assert.ok(timelineStart !== -1 && timelineEnd !== -1 && timelineEnd > timelineStart, 'test should locate the timeline layout block');

const timelineSource = source.slice(timelineStart, timelineEnd);
const compensationIndex = source.indexOf('const TIMELINE_BRANCH_TAG_CENTER_COMPENSATION = 10;');

assert.ok(
  timelineSource.includes('const y0 = anchorPos.y;'),
  'the first thread branch lane should start at the anchor Y with no extra offset'
);
assert.ok(
  !timelineSource.includes('const y0 = anchorPos.y + lane * 28;'),
  'thread layout should no longer add per-lane Y offset at the lane start'
);
assert.ok(
  compensationIndex !== -1,
  'thread layout should define a fixed branch-tag height compensation'
);
assert.ok(
  timelineSource.includes('const shouldCompensateBranchTag = index === 0 && mainlineSet.has(group.branch.anchor_node_id);'),
  'thread layout should only compensate the first branch node when its anchor is on the mainline'
);
assert.ok(
  timelineSource.includes('y: y0 + index * branchStepY - (shouldCompensateBranchTag ? TIMELINE_BRANCH_TAG_CENTER_COMPENSATION : 0),'),
  'thread layout should limit branch-tag compensation to mainline-to-first-branch connections'
);

console.log('Thread lane offset and branch-tag compensation passed.');
