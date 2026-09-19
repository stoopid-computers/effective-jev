import { Schema } from "effect";
import type {
  EntryType,
  ModelCard,
  Questions,
  Question as QuestionType,
  SystemOneRequestPayload,
  SystemOneResult,
  Usage as UsageType,
} from "./types.ts";

/** JSON values accepted as state, instructions, and descriptions. */
export const Entry: Schema.Codec<EntryType> = Schema.Union([
  Schema.String,
  Schema.JsonObject,
  Schema.Array(Schema.Json),
  Schema.Null,
]);

const nonEmptyRecord = Schema.makeFilter<Readonly<Record<string, unknown>>>(
  (value) => Object.keys(value).length > 0 || "Expected at least one entry",
);

/** The three question shapes accepted by the HTTP API. */
export const Question: Schema.Codec<QuestionType> = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("noul"),
    instructions: Schema.optional(Entry),
    criteria: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          true: Schema.optional(Entry),
          false: Schema.optional(Entry),
        }),
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.optional(Entry),
    criteria: Schema.Record(Schema.String, Entry).check(nonEmptyRecord),
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: Schema.optional(Entry),
    criteria: Schema.TupleWithRest(Schema.Tuple([Entry, Entry]), [Entry]),
  }),
]);

/** Validated request body, after resolving the default model. */
export const SystemOneRequest: Schema.Codec<SystemOneRequestPayload> = Schema.Struct({
  state: Entry,
  model: Schema.NonEmptyString,
  questions: Schema.Record(Schema.String, Question).check(nonEmptyRecord),
});

/** A probability or confidence value from zero through one. */
export const Probability: Schema.Codec<number> = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

/** Token counts are non-negative integers. */
export const Usage: Schema.Codec<UsageType> = Schema.Struct({
  input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** Public model metadata. Additional fields remain available on the raw response. */
export const Model: Schema.Codec<ModelCard> = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  release_date: Schema.String,
});

/** Response from GET /v1/models. */
export const Models: Schema.Codec<{ readonly models: ReadonlyArray<ModelCard> }> = Schema.Struct({
  models: Schema.Array(Model),
});

const jsonEqual = Schema.toEquivalence(Schema.Json);
const fieldsFor = <A>(
  keys: ReadonlyArray<string>,
  value: (key: string, index: number) => A,
): Record<string, A> => Object.fromEntries(keys.map((key, index) => [key, value(key, index)]));

/** Build the response schema from the question IDs, choice labels, and score rubric. */
export const systemOneResult = <Q extends Questions>(
  questions: Q,
): Schema.Codec<SystemOneResult<Q>> => {
  const answerSchema = (question: Questions[string]): Schema.Codec<unknown> => {
    switch (question.type) {
      case "noul":
        return Schema.Struct({ type: Schema.Literal("noul"), noul: Probability });
      case "choice": {
        const labels = Object.keys(question.criteria);
        return Schema.Struct({
          type: Schema.Literal("choice"),
          choice: Schema.Literals(labels),
          confidence: Probability,
          probabilities: Schema.Struct(fieldsFor(labels, () => Probability)),
        });
      }
      case "score": {
        const indices = question.criteria.map((_, index) => String(index));
        return Schema.Struct({
          type: Schema.Literal("score"),
          score: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: indices.length - 1 })),
          confidence: Probability,
          legend: Schema.Struct(
            fieldsFor(indices, (_, index) =>
              Entry.check(
                Schema.makeFilter(
                  (value) =>
                    jsonEqual(value, question.criteria[index] ?? null) ||
                    "Score legend does not match the requested rubric",
                ),
              ),
            ),
          ),
          probabilities: Schema.Struct(fieldsFor(indices, () => Probability)),
        });
      }
    }
  };
  const answers: Record<string, Schema.Codec<unknown>> = Object.fromEntries(
    Object.entries(questions).map(([name, question]) => [name, answerSchema(question)]),
  );
  // The fields above are built from Q at runtime. Each required key and its value
  // are checked before the result is exposed with the corresponding mapped type.
  return Schema.Struct({
    model: Schema.String,
    answers: Schema.Struct(answers),
    usage: Usage,
  }) as unknown as Schema.Codec<SystemOneResult<Q>>;
};
