import type { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { describe, expectTypeOf, it } from "vitest";
import {
  choice,
  noul,
  type ScoreCriteria,
  score,
  TypeSafeClient,
  type TypeSafeClientService,
  type TypeSafeConfigError,
  type TypeSafeError,
} from "../src";

declare const client: TypeSafeClientService;

describe("Effect API inference", () => {
  it("preserves typed question IDs, choice labels, and score indices", () => {
    const request = client.systemOne({
      state: null,
      questions: {
        ok: noul(),
        category: choice(null, { billing: null, other: null }),
        level: score(null, ["low", "high"]),
      },
    });
    type Result = Effect.Success<typeof request>;
    expectTypeOf<Result["answers"]["ok"]["noul"]>().toEqualTypeOf<number>();
    expectTypeOf<Result["answers"]["category"]["choice"]>().toEqualTypeOf<"billing" | "other">();
    expectTypeOf<keyof Result["answers"]["level"]["probabilities"]>().toEqualTypeOf<"0" | "1">();
    expectTypeOf<Result["answers"]["level"]["legend"]["0"]>().toEqualTypeOf<"low">();
    expectTypeOf<Effect.Error<typeof request>>().toEqualTypeOf<TypeSafeError>();
    expectTypeOf<Effect.Services<typeof request>>().toEqualTypeOf<never>();
  });

  it("requires HttpClient only when constructing the service", () => {
    const make = TypeSafeClient.make({ apiKey: "test" });
    expectTypeOf<Effect.Success<typeof make>>().toEqualTypeOf<TypeSafeClientService>();
    expectTypeOf<Effect.Error<typeof make>>().toEqualTypeOf<TypeSafeConfigError>();
    expectTypeOf<Effect.Services<typeof make>>().toEqualTypeOf<HttpClient.HttpClient>();
  });

  it("retains metadata inference and supports dynamic score arrays", () => {
    const remainingCriteria = ["c"];
    const criteria: ScoreCriteria = ["a", "b", ...remainingCriteria];
    const request = client.systemOneWithResponse({
      state: null,
      questions: { level: score(null, criteria) },
    });
    type Result = Effect.Success<typeof request>;
    expectTypeOf<
      keyof Result["data"]["answers"]["level"]["probabilities"]
    >().toEqualTypeOf<number>();
    expectTypeOf<Result["requestId"]>().toEqualTypeOf<string | undefined>();
  });

  it("rejects unsupported question and request shapes", () => {
    // @ts-expect-error choices require named labels
    choice(null, ["a", "b"]);
    // @ts-expect-error score criteria are an ordered list
    score(null, { 0: "a", 1: "b" });
    // @ts-expect-error scores require at least two levels
    score(null, ["one"]);
    // @ts-expect-error descriptions cannot be bare numbers
    noul(42);
    // @ts-expect-error request effects are not Promises
    client.models.list().then(() => {});
  });
});

describe("development type defaults", () => {
  it("treats parsed JSON as unknown", () => {
    expectTypeOf(JSON.parse('{"ok":true}')).toBeUnknown();
  });

  it("narrows falsy values with filter(Boolean)", () => {
    const values: Array<string | undefined> = ["ready", undefined];
    expectTypeOf(values.filter(Boolean)).toEqualTypeOf<string[]>();
  });
});
