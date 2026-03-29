import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ContextMap.tsx', import.meta.url), 'utf8');

assert.ok(!source.includes('<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">Scope</span>'),
  'ContextMap should not render the scope summary panel');
assert.ok(source.includes('Visible only'),
  'ContextMap should keep the simplified legend after removing the scope summary panel');

console.log('Context map scope panel removal passed.');
