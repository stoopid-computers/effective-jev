import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { choice, noul, type Questions, score } from "../src";
import { ANSWER, jsonResponse, makeClient, mockHttp } from "./helpers";

const questions = {
  ok: noul(),
  tone: choice(null, { warm: null, cold: null }),
  level: score(null, [null, { description: ["high", true] }]),
};
const valid = {
  ...ANSWER,
  answers: {
    ...ANSWER.answers,
    tone: {
      type: "choice",
      choice: "warm",
      confidence: 0.8,
      probabilities: { warm: 0.8, cold: 0.2 },
    },
    level: {
      type: "score",
      score: 0.7,
      confidence: 0.6,
      probabilities: { 0: 0.3, 1: 0.7 },
      legend: { 0: null, 1: { description: ["high", true] } },
    },
  },
};

it.effect("decodes all question kinds, literal labels, score legends, and usage", () =>
  Effect.gen(function* () {
    const { http } = mockHttp(() => Effect.sync(() => jsonResponse(valid)));
    const response = yield* (yield* makeClient(http)).systemOneWithResponse({
      state: null,
      questions,
    });
    expect(response.data).toEqual(valid);
    expect(response.requestId).toBeUndefined();
  }),
);

it.effect.each([
  { ...ANSWER, answers: {} },
  { ...ANSWER, answers: { ok: { type: "noul", noul: -0.1 } } },
  { ...ANSWER, answers: { ok: { type: "noul", noul: 1.1 } } },
  { ...ANSWER, answers: { ok: { type: "noul", noul: "0.9" } } },
  { ...ANSWER, answers: { ok: { type: "score", score: 0 } } },
  { ...ANSWER, usage: { input_tokens: -1, output_tokens: 2 } },
  { ...ANSWER, usage: { input_tokens: 1.5, output_tokens: 2 } },
  { model: "jev", answers: ANSWER.answers },
])("rejects malformed successful answers without retrying %#", (body) =>
  Effect.gen(function* () {
    const { http, calls } = mockHttp(() =>
      Effect.sync(() => jsonResponse(body, 200, { "x-typesafe-request-id": "bad-answer" })),
    );
    const error = yield* (yield* makeClient(http))
      .systemOne({ state: null, questions: { ok: noul() } })
      .pipe(Effect.flip);
    expect(error._tag).toBe("ResponseValidationError");
    expect(error).toMatchObject({ requestId: "bad-answer" });
    expect(calls).toHaveLength(1);
  }),
);

it.effect.each([
  { ...valid.answers.tone, choice: "missing" },
  { ...valid.answers.tone, probabilities: { warm: 1 } },
  { ...valid.answers.tone, confidence: 1.1 },
])("rejects invalid choice labels and incomplete distributions %#", (tone) =>
  Effect.gen(function* () {
    const { http } = mockHttp(() =>
      Effect.sync(() => jsonResponse({ ...valid, answers: { ...valid.answers, tone } })),
    );
    expect(
      (yield* (yield* makeClient(http)).systemOne({ state: null, questions }).pipe(Effect.flip))
        ._tag,
    ).toBe("ResponseValidationError");
  }),
);

it.effect.each([
  { ...valid.answers.level, score: 2 },
  { ...valid.answers.level, probabilities: { 0: 1 } },
  { ...valid.answers.level, legend: { 0: null, 1: "wrong rubric" } },
])("rejects invalid score ranges, distributions, and legends %#", (level) =>
  Effect.gen(function* () {
    const { http } = mockHttp(() =>
      Effect.sync(() => jsonResponse({ ...valid, answers: { ...valid.answers, level } })),
    );
    expect(
      (yield* (yield* makeClient(http))
        .systemOne({ state: null, questions: questions as Questions })
        .pipe(Effect.flip))._tag,
    ).toBe("ResponseValidationError");
  }),
);

it.effect.each([
  "not JSON",
  "",
  JSON.stringify({ models: null }),
  JSON.stringify({ models: [{ name: "incomplete" }] }),
])("validates model responses %#", (body) =>
  Effect.gen(function* () {
    const { http, calls } = mockHttp(() => Effect.succeed(new Response(body)));
    const error = yield* (yield* makeClient(http)).models.list().pipe(Effect.flip);
    expect(error._tag).toBe("ResponseValidationError");
    expect(calls).toHaveLength(1);
  }),
);
