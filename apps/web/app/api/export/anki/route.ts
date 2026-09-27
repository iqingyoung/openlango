import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { ensureLearner, getDb } from '@/lib/server';
import { buildApkg, type GrammarRow } from '@/lib/anki';
import { vocabStates, grammarStates, GRAMMAR } from '@openlango/core';

/** Anki .apkg 导出：词汇 + 语法双牌组 */
export async function GET() {
  const learner = await ensureLearner();
  const db = getDb();

  const vocabRows = await db.select().from(vocabStates).where(eq(vocabStates.learnerId, learner.id));
  const vocab = vocabRows.map((r) => ({
    word: r.word,
    cefr: r.cefr,
    band: r.band,
    state: r.state,
  }));

  const grammarStateRows = await db.select().from(grammarStates).where(eq(grammarStates.learnerId, learner.id));
  const known = new Set(grammarStateRows.map((r) => r.grammarId));
  const grammar: GrammarRow[] = (known.size > 0 ? GRAMMAR.filter((g) => known.has(g.id)) : GRAMMAR).map((g) => ({
    name: g.name,
    zh: g.zh,
    formula: g.formula,
    examples: g.examples,
    cefr: g.cefr,
  }));

  const apkg = await buildApkg(vocab, grammar);
  return new NextResponse(new Uint8Array(apkg), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="openlango.apkg"',
    },
  });
}

export const dynamic = 'force-dynamic';
