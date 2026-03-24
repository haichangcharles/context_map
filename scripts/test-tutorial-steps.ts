import assert from 'node:assert/strict';
import { tutorialSteps } from '../src/tutorial/steps';

assert.ok(tutorialSteps.length >= 7, 'tutorial should cover the full user journey');

const stepIds = tutorialSteps.map((step) => step.id);

assert.deepEqual(
  stepIds,
  [
    'enter-workspace',
    'mainline-chat',
    'message-actions',
    'branching',
    'context-governance',
    'pattern-extraction',
    'mixed-initiative',
  ],
  'tutorial step order should follow the intended user journey'
);

const governance = tutorialSteps.find((step) => step.id === 'context-governance');
assert.ok(governance, 'context governance step should exist');
assert.ok(
  governance!.highlights.some((item) => item.title.includes('Select')),
  'context governance should explain selection mode'
);
assert.ok(
  governance!.highlights.some((item) => item.title.includes('floating action bar')),
  'context governance should explain the floating action bar reveal'
);

const extraction = tutorialSteps.find((step) => step.id === 'pattern-extraction');
assert.ok(extraction, 'pattern extraction step should exist');
assert.ok(
  extraction!.pathways.includes('manual'),
  'pattern extraction should support manual initiation'
);
assert.ok(
  extraction!.pathways.includes('chat'),
  'pattern extraction should support natural-language initiation'
);
assert.ok(
  extraction!.pathways.includes('suggested'),
  'pattern extraction should support model-suggested initiation'
);

const mixedInitiative = tutorialSteps.find((step) => step.id === 'mixed-initiative');
assert.ok(mixedInitiative, 'mixed-initiative step should exist');
assert.ok(
  mixedInitiative!.pathways.includes('manual') &&
    mixedInitiative!.pathways.includes('chat') &&
    mixedInitiative!.pathways.includes('suggested'),
  'mixed-initiative step should unify manual, conversational, and suggested structural actions'
);

console.log('Tutorial step configuration passed.');
