import { Effect } from "effect";
import type { TypeSafeError } from "../errors.ts";
import { Models as ModelsSchema } from "../schemas.ts";
import type { Transport } from "../transport.ts";
import type { ModelCard, RequestOptions, WithResponse } from "../types.ts";

/** The models available to the account. */
export interface Models {
  readonly list: (
    options?: RequestOptions,
  ) => Effect.Effect<ReadonlyArray<ModelCard>, TypeSafeError>;
  readonly listWithResponse: (
    options?: RequestOptions,
  ) => Effect.Effect<WithResponse<ReadonlyArray<ModelCard>>, TypeSafeError>;
}

export const makeModels = (transport: Transport): Models => {
  const listWithResponse: Models["listWithResponse"] = (options) =>
    transport
      .request("GET", "/v1/models", ModelsSchema, options)
      .pipe(Effect.map(({ data, ...metadata }) => ({ ...metadata, data: data.models })));
  return {
    listWithResponse,
    list: (options) => listWithResponse(options).pipe(Effect.map(({ data }) => data)),
  };
};
