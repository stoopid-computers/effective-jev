import { Effect } from "effect";
import { choice, noul, score, TypeSafeClient } from "../src";

const program = Effect.gen(function* () {
  const client = yield* TypeSafeClient;
  const result = yield* client.systemOne({
    state: { document: "I was charged twice. Please fix this today." },
    questions: {
      category: choice("Which team should handle this?", {
        billing: null,
        technical: null,
        other: null,
      }),
      urgent: noul("Does the customer need help today?"),
      frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Angry"]),
    },
  });
  yield* Effect.log(result.answers);
});

await Effect.runPromise(program.pipe(Effect.provide(TypeSafeClient.layerFetch())));
