import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ContextMap.tsx', import.meta.url), 'utf8');

const selectorStart = source.indexOf('{/* Bottom Layout Mode Bar */}');
const selectorEnd = source.indexOf('{/* Context Menu */}');

assert.ok(selectorStart !== -1 && selectorEnd !== -1 && selectorEnd > selectorStart, 'test should locate the layout selector block');

const selectorSource = source.slice(selectorStart, selectorEnd);
const threadLabelIndex = selectorSource.indexOf('Thread');
const canvasLabelIndex = selectorSource.indexOf('Canvas');
const mapLabelIndex = selectorSource.indexOf('Map');
const defaultTimelineIndex = source.indexOf("useState<LayoutMode>('timeline')");
const defaultTreeIndex = source.indexOf("useState<LayoutMode>('tree')");

assert.ok(threadLabelIndex !== -1, 'layout selector should still expose a Thread option');
assert.ok(canvasLabelIndex !== -1, 'layout selector should still expose a Canvas option');
assert.ok(mapLabelIndex === -1, 'layout selector should hide the Map option');
assert.ok(threadLabelIndex < canvasLabelIndex, 'layout selector should place Thread before Canvas');
assert.ok(defaultTimelineIndex !== -1, 'layout selector should default to Thread mode');
assert.ok(defaultTreeIndex === -1, 'layout selector should no longer default to Canvas mode');

console.log('Layout selector order, visibility, and default mode passed.');
