import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ContextMap.tsx', import.meta.url), 'utf8');

const selectorStart = source.indexOf('{/* Bottom Layout Mode Bar */}');
const selectorEnd = source.indexOf('{/* Context Menu */}');

assert.ok(selectorStart !== -1 && selectorEnd !== -1 && selectorEnd > selectorStart, 'test should locate the layout selector block');

const selectorSource = source.slice(selectorStart, selectorEnd);
const compactLabelIndex = selectorSource.indexOf('Compact');
const looseLabelIndex = selectorSource.indexOf('Loose');
const mapLabelIndex = selectorSource.indexOf('Map');
const legacyThreadLabelIndex = selectorSource.indexOf('Thread');
const legacyCanvasLabelIndex = selectorSource.indexOf('Canvas');
const defaultTimelineIndex = source.indexOf("useState<LayoutMode>('timeline')");
const defaultTreeIndex = source.indexOf("useState<LayoutMode>('tree')");
const compactToggleHeightIndex = selectorSource.indexOf('min-h-7');
const compactToggleBorderIndex = selectorSource.indexOf('border-white/80');
const compactButtonIndex = selectorSource.indexOf('px-1.5 py-0.5 text-[9px] font-normal leading-none');

assert.ok(compactLabelIndex !== -1, 'layout selector should expose a Compact option');
assert.ok(looseLabelIndex !== -1, 'layout selector should expose a Loose option');
assert.ok(mapLabelIndex === -1, 'layout selector should hide the Map option');
assert.ok(legacyThreadLabelIndex === -1, 'layout selector should no longer expose a Thread option');
assert.ok(legacyCanvasLabelIndex === -1, 'layout selector should no longer expose a Canvas option');
assert.ok(compactLabelIndex < looseLabelIndex, 'layout selector should place Compact before Loose');
assert.ok(compactToggleHeightIndex !== -1, 'layout selector should use the smaller segmented control height');
assert.ok(compactToggleBorderIndex !== -1, 'layout selector should use the lighter segmented control shell');
assert.ok(compactButtonIndex !== -1, 'layout selector should use the smaller segmented control button sizing');
assert.ok(defaultTimelineIndex !== -1, 'layout selector should default to Thread mode');
assert.ok(defaultTreeIndex === -1, 'layout selector should no longer default to Canvas mode');

console.log('Layout selector labels, sizing, and default mode passed.');
