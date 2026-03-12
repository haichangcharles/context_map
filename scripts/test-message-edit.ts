import assert from 'node:assert/strict';
import { useAppStore } from '../src/store';

const resetStore = () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
};

const run = () => {
  resetStore();

  const projectId = useAppStore.getState().createProject('Editable transcript');
  const firstUserId = useAppStore.getState().addNode(projectId, null, 'user', 'Original user prompt', null);
  const firstAssistantId = useAppStore.getState().addNode(projectId, firstUserId, 'assistant', 'Original assistant reply', null);

  useAppStore.getState().editNodeContent(firstUserId, 'Edited user prompt');
  let editedUser = useAppStore.getState().nodes[firstUserId];
  assert.equal(editedUser.content, 'Edited user prompt');
  assert.ok(editedUser.metadata.edited_at, 'editing should stamp edited_at');

  useAppStore.getState().editNodeContent(firstUserId, 'Edited user prompt v2');
  editedUser = useAppStore.getState().nodes[firstUserId];
  assert.equal(editedUser.content, 'Edited user prompt v2');

  useAppStore.getState().editNodeContent(firstAssistantId, 'Original assistant reply');
  let untouchedAssistant = useAppStore.getState().nodes[firstAssistantId];
  assert.equal(untouchedAssistant.content, 'Original assistant reply');
  assert.equal(untouchedAssistant.metadata.edited_at, undefined, 'same-value edits should be ignored');

  useAppStore.getState().editNodeContent(firstAssistantId, 'Edited assistant reply');
  let editedAssistant = useAppStore.getState().nodes[firstAssistantId];
  assert.equal(editedAssistant.content, 'Edited assistant reply');
  assert.ok(editedAssistant.metadata.edited_at);

  console.log('Message edit tests passed.');
};

run();
