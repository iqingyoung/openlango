import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSentences } from './types.ts';

test('分句：基本标点切分', () => {
  assert.deepEqual(splitSentences('Hello there. How are you today? Nice!'), [
    'Hello there.',
    'How are you today?',
    'Nice!',
  ]);
});

test('分句：中文标点（短句按 minChars 并入下一句，避免碎片停顿）', () => {
  assert.deepEqual(splitSentences('你好。今天练什么？好！'), ['你好。 今天练什么？ 好！']);
  assert.deepEqual(splitSentences('这是一个比较长的句子。第二个句子也不短。好！'), [
    '这是一个比较长的句子。 第二个句子也不短。',
    '好！',
  ]);
});

test('分句：短片段并入下一句', () => {
  assert.deepEqual(splitSentences('Hi! I am fine thanks. And you?'), [
    'Hi! I am fine thanks.',
    'And you?',
  ]);
});

test('分句：超长句按逗号硬切', () => {
  const long = 'This is a very long sentence without any final punctuation, containing many clauses, and it keeps going on and on and on, far beyond the limit, so it must be split somewhere in the middle, for the text to speech engine, to handle it well enough, thank you very much indeed.';
  const out = splitSentences(long, { minChars: 12, maxChars: 80 });
  for (const s of out) {
    assert.ok(s.length <= 100, `chunk too long: ${s.length}`);
  }
  assert.ok(out.length >= 3);
});

test('分句：空串与无标点', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('no punctuation here'), ['no punctuation here']);
});
