import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { resolveConfig } from "./env.ts";
import { InvalidRequestError, type TypeSafeConfigError, type TypeSafeError } from "./errors.ts";
import { type Models, makeModels } from "./resources/models.ts";
import { SystemOneRequest as RequestSchema, systemOneResult } from "./schemas.ts";
import { makeTransport } from "./transport.ts";
import type {
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
  TypeSafeClientConfig,
  WithResponse,
} from "./types.ts";

/** Lazy, repeatable API operations. Interrupt the calling fiber to cancel a request or retry wait. */
export interface TypeSafeClientService {
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly models: Models;
  readonly systemOne: <const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ) => Effect.Effect<SystemOneResult<Q>, TypeSafeError>;
  readonly systemOneWithResponse: <const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ) => Effect.Effect<WithResponse<SystemOneResult<Q>>, TypeSafeError>;
}

const TypeSafeClientBase: Context.ServiceClass<
  TypeSafeClient,
  "@compootor/effective-jev/TypeSafeClient",
  TypeSafeClientService
> = Context.Service<TypeSafeClient, TypeSafeClientService>()(
  "@compootor/effective-jev/TypeSafeClient",
);

/** An Effect service for the TypeSafe Jev API. */
export class TypeSafeClient extends TypeSafeClientBase {
  /** Construct the service with configuration and an injected Effect HttpClient. */
  static make(
    options: TypeSafeClientConfig = {},
  ): Effect.Effect<TypeSafeClientService, TypeSafeConfigError, HttpClient.HttpClient> {
    return Effect.gen(function* () {
      const config = yield* resolveConfig(options);
      const transport = makeTransport(config, yield* HttpClient.HttpClient);
      const systemOneWithResponse: TypeSafeClientService["systemOneWithResponse"] = <
        const Q extends Questions,
      >(
        request: SystemOneRequest<Q>,
        requestOptions?: RequestOptions,
      ) =>
        Effect.gen(function* () {
          // Encode first to reject cycles without recursing through the question schema.
          // Decode a snapshot so edits to caller-owned data cannot change retry bodies or validation.
          const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
            ...request,
            model: request?.model ?? config.defaultModel,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new InvalidRequestError({
                  message: `Cannot encode request as JSON: ${cause.message}`,
                  cause,
                }),
            ),
          );
          const payload = yield* Schema.decodeEffect(Schema.fromJsonString(RequestSchema))(
            body,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new InvalidRequestError({
                  message: `Invalid systemOne request: ${cause.message}`,
                  cause,
                }),
            ),
          );
          // The decoded snapshot has the same question keys and criteria as Q.
          return yield* transport.request(
            "POST",
            "/v1/systemone",
            systemOneResult(payload.questions as Q),
            requestOptions,
            body,
          );
        });
      return TypeSafeClient.of({
        baseURL: config.baseURL,
        defaultModel: config.defaultModel,
        models: makeModels(transport),
        systemOneWithResponse,
        systemOne: (request, requestOptions) =>
          systemOneWithResponse(request, requestOptions).pipe(Effect.map(({ data }) => data)),
      });
    });
  }

  /** Provide the service while leaving the HttpClient implementation to the application. */
  static layer(
    options: TypeSafeClientConfig = {},
  ): Layer.Layer<TypeSafeClient, TypeSafeConfigError, HttpClient.HttpClient> {
    return Layer.effect(TypeSafeClient, TypeSafeClient.make(options));
  }

  /** Provide the service with Effect's FetchHttpClient. */
  static layerFetch(
    options: TypeSafeClientConfig = {},
  ): Layer.Layer<TypeSafeClient, TypeSafeConfigError> {
    return TypeSafeClient.layer(options).pipe(Layer.provide(FetchHttpClient.layer));
  }
}
