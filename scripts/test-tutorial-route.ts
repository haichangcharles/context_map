import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const tutorialSource = readFileSync(new URL('../src/components/TutorialView.tsx', import.meta.url), 'utf8');

assert.ok(
  appSource.includes("window.location.pathname === '/tutorial'"),
  'App should recognize the /tutorial route'
);

assert.ok(
  appSource.includes('TutorialView'),
  'App should render a TutorialView on the tutorial route'
);

assert.ok(
  tutorialSource.includes('像一篇可以阅读的教程文章'),
  'TutorialView should present the tutorial as a readable article in Chinese'
);

assert.ok(
  tutorialSource.includes('一个真实的 Q / A 示例'),
  'TutorialView should embed a concrete Q/A example for message actions'
);

assert.ok(
  tutorialSource.includes('一个只有三个节点的小地图'),
  'TutorialView should embed a small three-node map demo for context-map teaching'
);

console.log('Tutorial route wiring passed.');
