import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { choice, noul, score, TypeSafeClient } from "../../src";

/** Live calls are opt-in and require TYPESAFE_API_KEY. */
describe.skipIf(!process.env.TYPESAFE_API_KEY)("live TypeSafe API", () => {
  it("lists models with response metadata", async () => {
    const result = await Effect.runPromise(
      TypeSafeClient.use((client) => client.models.listWithResponse()).pipe(
        Effect.provide(TypeSafeClient.layerFetch({ timeout: 120_000 })),
      ),
    );
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.requestId).toBeTruthy();
  });

  it("answers all question types with inferred results", async () => {
    const result = await Effect.runPromise(
      TypeSafeClient.use((client) =>
        client.systemOne({
          state: "I was charged twice. Please fix this today.",
          questions: {
            billing: noul("Is this about billing?"),
            tone: choice("What is the tone?", { calm: null, upset: null }),
            urgency: score("How urgent?", ["Can wait", "This week", "Today"]),
          },
        }),
      ).pipe(Effect.provide(TypeSafeClient.layerFetch({ timeout: 120_000 }))),
    );
    expect(result.answers.billing.noul).toBeGreaterThanOrEqual(0);
    expect(["calm", "upset"]).toContain(result.answers.tone.choice);
    expect(result.answers.urgency.legend).toEqual({ 0: "Can wait", 1: "This week", 2: "Today" });
  });
});
