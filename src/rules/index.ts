// Rules as data (CLAUDE.md non-negotiable 6; D-8, D-15). Closed zod schemas for rules/ranking.json and
// rules/limits.json. A bad file throws RULES_INVALID naming the first offending field. No I/O here: callers read
// the file; the engines take the parsed object.
import { z } from 'zod';
import { RulesInvalid } from '@/shared/errors';

export const ACTIONS = ['post', 'comment', 'vote', 'report'] as const;
export type Action = (typeof ACTIONS)[number];

const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

export const RankingRulesSchema = z
  .object({
    version: z.literal(1),
    hot: z.object({ epoch_seconds: nonNegInt, gravity_seconds: positiveInt }).strict(),
    best: z.object({ z: z.number().positive() }).strict(),
    top: z
      .object({
        windows_seconds: z.object({ day: positiveInt, week: positiveInt, all: z.null() }).strict(),
      })
      .strict(),
    recompute: z.object({ interval_seconds: positiveInt }).strict(),
  })
  .strict();
export type RankingRules = z.infer<typeof RankingRulesSchema>;
export type TopWindow = keyof RankingRules['top']['windows_seconds'];

export const LimitRulesSchema = z
  .object({
    version: z.literal(1),
    young_account: z.object({ max_age_hours: positiveInt, max_contributions: positiveInt }).strict(),
    downvote_gate: z.object({ min_age_hours: positiveInt, min_contributions: positiveInt }).strict(),
    windows: z
      .array(
        z
          .object({ action: z.enum(ACTIONS), per_seconds: positiveInt, max: positiveInt, young_max: positiveInt })
          .strict()
          .refine((w) => w.young_max <= w.max, { message: 'young_max must not exceed max', path: ['young_max'] }),
      )
      .refine((ws) => new Set(ws.map((w) => w.action)).size === ws.length, { message: 'duplicate action' })
      .refine((ws) => ACTIONS.every((a) => ws.some((w) => w.action === a)), { message: `every action needs a window: ${ACTIONS.join(', ')}` }),
    edit_window_seconds: positiveInt,
    max_depth_rendered: positiveInt,
    upload: z.object({ max_bytes: positiveInt, types: z.array(z.string().regex(/^image\//)).nonempty() }).strict(),
  })
  .strict();
export type LimitRules = z.infer<typeof LimitRulesSchema>;
export type WindowRule = LimitRules['windows'][number];

function parse<T>(schema: z.ZodType<T>, input: unknown, file: string): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const issue = r.error.issues[0]!;
  const field = issue.path.length ? issue.path.join('.') : file;
  throw new RulesInvalid(field, issue.message);
}

export const parseRankingRules = (input: unknown): RankingRules => parse(RankingRulesSchema, input, 'rules/ranking.json');
export const parseLimitRules = (input: unknown): LimitRules => parse(LimitRulesSchema, input, 'rules/limits.json');

export function windowFor(rules: LimitRules, action: Action): WindowRule {
  const w = rules.windows.find((x) => x.action === action);
  if (!w) throw new RulesInvalid('windows', `no window for ${action}`); // unreachable after parse; kept for callers with partial rules
  return w;
}
