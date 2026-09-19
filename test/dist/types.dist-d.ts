import type { Effect } from "effect";
import { expectTypeOf, it } from "vitest";
import {
  choice,
  score,
  type TypeSafeClient,
  type TypeSafeClientService,
  type TypeSafeError,
} from "../../dist/index.mjs";

declare const client: TypeSafeClientService;
it("preserves answer and error inference in emitted declarations", () => {
  const operation = client.systemOne({
    state: null,
    questions: {
      tone: choice(null, { warm: null, cold: null }),
      level: score(null, ["low", "high"]),
    },
  });
  type Result = Effect.Success<typeof operation>;
  expectTypeOf<Result["answers"]["tone"]["choice"]>().toEqualTypeOf<"warm" | "cold">();
  expectTypeOf<Result["answers"]["level"]["legend"]["0"]>().toEqualTypeOf<"low">();
  expectTypeOf<Effect.Error<typeof operation>>().toEqualTypeOf<TypeSafeError>();
  expectTypeOf<typeof TypeSafeClient.layerFetch>().toBeFunction();
});

it("does not change consumer global types through the SDK declarations", () => {
  expectTypeOf(JSON.parse('{"ok":true}')).toBeAny();
});
