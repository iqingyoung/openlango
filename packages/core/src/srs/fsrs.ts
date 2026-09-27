/**
 * FSRS 调度封装（ts-fsrs），映射到 vocab_states/grammar_states 的列。
 * 词汇与语法共用同一调度器。
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Grade,
} from 'ts-fsrs';

export { Rating, State };
export type SrsRating = 1 | 2 | 3 | 4; // Again/Hard/Good/Easy

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export interface SrsFields {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number; // ts-fsrs State 枚举
  dueAt: Date | null;
}

export function emptySrsFields(now = new Date()): SrsFields {
  const c = createEmptyCard(now);
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number,
    dueAt: c.due,
  };
}

/** 复习一次：rating 1=忘了 2=难 3=记得 4=轻松 */
export function review(fields: SrsFields, rating: SrsRating, now = new Date()): SrsFields {
  // createEmptyCard 保证拿到当前版本完整的 Card 结构（含 learning_steps 等新字段）
  const card = createEmptyCard(fields.dueAt ?? now);
  card.due = fields.dueAt ?? now;
  card.stability = fields.stability;
  card.difficulty = fields.difficulty;
  card.reps = fields.reps;
  card.lapses = fields.lapses;
  card.state = (fields.state as State) ?? State.New;
  const out = scheduler.next(card, now, rating as Grade);
  return {
    stability: out.card.stability,
    difficulty: out.card.difficulty,
    reps: out.card.reps,
    lapses: out.card.lapses,
    state: out.card.state as number,
    dueAt: out.card.due,
  };
}

export function isDue(fields: { dueAt: Date | null }, now = new Date()): boolean {
  return fields.dueAt === null || fields.dueAt.getTime() <= now.getTime();
}
