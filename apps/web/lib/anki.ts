/**
 * Anki .apkg 导出（legacy schema：collection.anki2 + media）。
 * 现代 Anki (2.1.x) 导入 legacy apkg 时自动升级 schema。
 * 牌组：OpenLango::词汇（word → CEFR/状态）与 OpenLango::语法（名称/公式 → 原创例句）。
 */
import initSqlJs_ from 'better-sqlite3';
import JSZip from 'jszip';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface VocabRow {
  word: string;
  cefr: string | null;
  band: number | null;
  state: string;
}
export interface GrammarRow {
  name: string;
  zh: string;
  formula: string;
  examples: string[];
  cefr: string;
}

const MODEL_ID = 1750000000001;
const DECK_VOCAB = 1750000000002;
const DECK_GRAMMAR = 1750000000003;

const MODEL_JSON = JSON.stringify({
  [MODEL_ID]: {
    id: MODEL_ID,
    name: 'OpenLango Basic',
    type: 0,
    mod: Math.floor(Date.now() / 1000),
    usn: -1,
    sortf: 0,
    did: DECK_VOCAB,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr id="answer">{{Back}}<br><small>{{Extra}}</small>',
        bqfmt: '',
        bafmt: '',
        did: null,
      },
    ],
    flds: [
      { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Extra', ord: 2, sticky: false, rtl: false, font: 'Arial', size: 14, media: [] },
    ],
    css: '.card { font-family: Arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'all', [0]]],
    tags: [],
    vers: [],
  },
});

const DECKS_JSON = JSON.stringify({
  1: { id: 1, name: 'Default', desc: '', mod: 0, usn: 0, collapsed: false, browserCollapsed: false, descCollapsed: false, dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
  [DECK_VOCAB]: { id: DECK_VOCAB, name: 'OpenLango::词汇', desc: 'OpenLango 词汇（FSRS 学习集）', mod: 0, usn: 0, collapsed: false, browserCollapsed: false, descCollapsed: false, dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
  [DECK_GRAMMAR]: { id: DECK_GRAMMAR, name: 'OpenLango::语法', desc: 'OpenLango 语法清单（A1-B2，原创例句）', mod: 0, usn: 0, collapsed: false, browserCollapsed: false, descCollapsed: false, dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
});

const DCONF_JSON = JSON.stringify({
  1: { id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, iaq: false, ease4: 1.3, ivlFct: 1, adjIvl: false, delays: [1, 10], newPerDay: 20, revPerDay: 200, leechFails: 8, leechAction: 0, lapIvlFct: 0.75, bury: true, new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], perDay: 20, separate: true }, rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 } },
});

const CONF_JSON = JSON.stringify({
  nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0, sortBackwards: false,
  addToCur: true, curModel: MODEL_ID, collapseTime: 1200, dayLearnFirst: false,
});

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);
CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
CREATE TABLE graves (usn integer, oid integer, type integer);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function csum(text: string): number {
  return parseInt(createHash('sha1').update(text).digest('hex').slice(0, 8), 16);
}

interface CardSpec {
  deckId: number;
  front: string;
  back: string;
  extra: string;
  tags: string[];
}

export async function buildApkg(vocab: VocabRow[], grammar: GrammarRow[]): Promise<Uint8Array> {
  const cards: CardSpec[] = [];
  for (const v of vocab) {
    cards.push({
      deckId: DECK_VOCAB,
      front: v.word,
      back: v.cefr ? `CEFR ${v.cefr}` : '—',
      extra: `状态 ${v.state} · 频段 ${v.band ?? '-'} · OpenLango`,
      tags: ['openlango', 'vocab'],
    });
  }
  for (const g of grammar) {
    cards.push({
      deckId: DECK_GRAMMAR,
      front: `${g.name}（${g.zh}）`,
      back: `${g.formula}<br>${g.cefr}`,
      extra: g.examples.map((e) => `• ${e}`).join('<br>'),
      tags: ['openlango', 'grammar', `cefr-${g.cefr.toLowerCase()}`],
    });
  }

  const Sqlite = initSqlJs_;
  const tmp = await mkdtemp(join(tmpdir(), 'anki-'));
  const dbPath = join(tmp, 'collection.anki2');
  const db = new Sqlite(dbPath); // better-sqlite3 无内存序列化 API，落临时文件再读字节
  let anki2: Uint8Array;
  try {
  db.exec(SCHEMA);
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(
    'INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)',
  ).run(nowSec - 86400, nowSec, Date.now(), CONF_JSON, MODEL_JSON, DECKS_JSON, DCONF_JSON, '{}');

  const insNote = db.prepare(
    'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, \'\')',
  );
  const insCard = db.prepare(
    'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, \'\')',
  );
  let ts = Date.now();
  let due = 1;
  for (const c of cards) {
    ts += 1;
    const nid = ts;
    const flds = [c.front, c.back, c.extra].join('\x1f');
    insNote.run(
      nid,
      randomBytes(8).toString('hex'),
      MODEL_ID,
      nowSec,
      c.tags.join(' '),
      flds,
      0,
      csum(c.front),
    );
    insCard.run(ts + 1_000_000, nid, c.deckId, nowSec, due);
    due += 1;
  }

  db.close();
  anki2 = new Uint8Array(await readFile(dbPath));
  } finally {
    void rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  const zip = new JSZip();
  zip.file('media', '{}');
  zip.file('collection.anki2', anki2);
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return buf;
}
