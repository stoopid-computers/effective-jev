import type {
  ChoiceCriteria,
  ChoiceQuestion,
  EntryType,
  NoulQuestion,
  ScoreCriteria,
  ScoreQuestion,
} from "./types.ts";

/** Build a yes/no question. The client validates questions when their Effect runs. */
export const noul = (
  instructions: EntryType = null,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion => ({ type: "noul", instructions, criteria });

/** Build a score question with at least two ordered descriptions. */
export const score = <const T extends ScoreCriteria>(
  instructions: EntryType,
  criteria: T,
): ScoreQuestion<T> => ({ type: "score", instructions, criteria });

/** Build a choice question, preserving the literal labels in the answer type. */
export const choice = <const T extends ChoiceCriteria>(
  instructions: EntryType,
  criteria: T,
): ChoiceQuestion<T> => ({ type: "choice", instructions, criteria });
