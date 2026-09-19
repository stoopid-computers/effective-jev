import { type Cause, Schema } from "effect";
import type { Headers } from "effect/unstable/http";

// Explicit base types let JSR generate declarations for Effect's class factories.
type ErrorClass<Self, Tag extends string, Fields extends Schema.Struct.Fields> = Schema.Class<
  Self,
  Schema.TaggedStruct<Tag, Fields>,
  Cause.YieldableError
>;

const TypeSafeConfigErrorBase: ErrorClass<
  TypeSafeConfigError,
  "TypeSafeConfigError",
  { readonly message: Schema.String }
> = Schema.TaggedError<TypeSafeConfigError>()("TypeSafeConfigError", { message: Schema.String });

/** Invalid client configuration, including missing credentials. */
export class TypeSafeConfigError extends TypeSafeConfigErrorBase {}

const InvalidRequestErrorBase: ErrorClass<
  InvalidRequestError,
  "InvalidRequestError",
  { readonly message: Schema.String; readonly cause: Schema.optional<Schema.Defect> }
> = Schema.TaggedError<InvalidRequestError>()("InvalidRequestError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
});

/** Invalid questions, request options, or a body that cannot be encoded as JSON. */
export class InvalidRequestError extends InvalidRequestErrorBase {}

const ResponseValidationErrorBase: ErrorClass<
  ResponseValidationError,
  "ResponseValidationError",
  {
    readonly message: Schema.String;
    readonly cause: Schema.Defect;
    readonly requestId: Schema.UndefinedOr<Schema.String>;
  }
> = Schema.TaggedError<ResponseValidationError>()("ResponseValidationError", {
  message: Schema.String,
  cause: Schema.Defect(),
  requestId: Schema.UndefinedOr(Schema.String),
});

/** A successful HTTP response that does not match the requested answer schema. */
export class ResponseValidationError extends ResponseValidationErrorBase {}

const APIConnectionErrorBase: ErrorClass<
  APIConnectionError,
  "APIConnectionError",
  { readonly message: Schema.String; readonly cause: Schema.Defect }
> = Schema.TaggedError<APIConnectionError>()("APIConnectionError", {
  message: Schema.String,
  cause: Schema.Defect(),
});

/** The transport failed while sending a request or receiving its body. */
export class APIConnectionError extends APIConnectionErrorBase {}

const APITimeoutErrorBase: ErrorClass<
  APITimeoutError,
  "APITimeoutError",
  { readonly message: Schema.String; readonly timeoutMs: Schema.Finite }
> = Schema.TaggedError<APITimeoutError>()("APITimeoutError", {
  message: Schema.String,
  timeoutMs: Schema.Finite,
});

/** An attempt exceeded its timeout, including response body delivery. */
export class APITimeoutError extends APITimeoutErrorBase {}

type APIErrorFields = {
  message: Schema.String;
  status: Schema.Finite;
  headers: Schema.$Record<Schema.String, Schema.String>;
  body: Schema.Unknown;
  requestId: Schema.UndefinedOr<Schema.String>;
};

const apiErrorFields: APIErrorFields = {
  message: Schema.String,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Unknown,
  requestId: Schema.UndefinedOr(Schema.String),
};

const APIErrorBase: ErrorClass<APIError, "APIError", APIErrorFields> =
  Schema.TaggedError<APIError>()("APIError", apiErrorFields);

/** An HTTP error without a more specific status tag. */
export class APIError extends APIErrorBase {}

const BadRequestErrorBase: ErrorClass<BadRequestError, "BadRequestError", APIErrorFields> =
  Schema.TaggedError<BadRequestError>()("BadRequestError", apiErrorFields);

/** HTTP 400. */
export class BadRequestError extends BadRequestErrorBase {}

const AuthenticationErrorBase: ErrorClass<
  AuthenticationError,
  "AuthenticationError",
  APIErrorFields
> = Schema.TaggedError<AuthenticationError>()("AuthenticationError", apiErrorFields);

/** HTTP 401. */
export class AuthenticationError extends AuthenticationErrorBase {}

const PermissionDeniedErrorBase: ErrorClass<
  PermissionDeniedError,
  "PermissionDeniedError",
  APIErrorFields
> = Schema.TaggedError<PermissionDeniedError>()("PermissionDeniedError", apiErrorFields);

/** HTTP 403. */
export class PermissionDeniedError extends PermissionDeniedErrorBase {}

const NotFoundErrorBase: ErrorClass<NotFoundError, "NotFoundError", APIErrorFields> =
  Schema.TaggedError<NotFoundError>()("NotFoundError", apiErrorFields);

/** HTTP 404. */
export class NotFoundError extends NotFoundErrorBase {}

const UnprocessableEntityErrorBase: ErrorClass<
  UnprocessableEntityError,
  "UnprocessableEntityError",
  APIErrorFields
> = Schema.TaggedError<UnprocessableEntityError>()("UnprocessableEntityError", apiErrorFields);

/** HTTP 422. */
export class UnprocessableEntityError extends UnprocessableEntityErrorBase {}

const RateLimitErrorBase: ErrorClass<
  RateLimitError,
  "RateLimitError",
  Readonly<APIErrorFields> & {
    readonly retryAfterMs: Schema.UndefinedOr<Schema.Finite>;
  }
> = Schema.TaggedError<RateLimitError>()("RateLimitError", {
  ...apiErrorFields,
  retryAfterMs: Schema.UndefinedOr(Schema.Finite),
});

/** HTTP 429, with the server's requested delay in milliseconds when valid. */
export class RateLimitError extends RateLimitErrorBase {}

const InternalServerErrorBase: ErrorClass<
  InternalServerError,
  "InternalServerError",
  APIErrorFields
> = Schema.TaggedError<InternalServerError>()("InternalServerError", apiErrorFields);

/** HTTP 5xx. */
export class InternalServerError extends InternalServerErrorBase {}

/** All failures returned for non-success HTTP statuses. */
export type APIResponseError =
  | APIError
  | BadRequestError
  | AuthenticationError
  | PermissionDeniedError
  | NotFoundError
  | UnprocessableEntityError
  | RateLimitError
  | InternalServerError;

/** The error channel of client requests. Fiber interruption remains an interruption. */
export type TypeSafeError =
  | APIResponseError
  | APIConnectionError
  | APITimeoutError
  | InvalidRequestError
  | ResponseValidationError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractMessage = (body: unknown): string | undefined => {
  if (typeof body === "string") return body || undefined;
  if (!isRecord(body)) return undefined;
  const { error, message, detail } = body;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  if (typeof detail === "string") return detail;
  if (isRecord(detail) && typeof detail.message === "string") return detail.message;
  if (!Array.isArray(detail)) return undefined;
  const parts = detail.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.msg !== "string") return [];
    const path = Array.isArray(entry.loc)
      ? entry.loc.filter((key) => key !== "body").join(".")
      : "";
    return [path ? `${path}: ${entry.msg}` : entry.msg];
  });
  return parts.length > 0 ? parts.join("; ") : undefined;
};

/** Convert an HTTP failure to a tagged error without losing its body or request ID. */
export const fromResponse = (
  status: number,
  body: unknown,
  headers: Headers.Headers,
  retryAfterMs: number | undefined,
): APIResponseError => {
  const detail = extractMessage(body);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const message = detail
    ? `${status} ${detail}`
    : raw === undefined
      ? `${status} status code (no body)`
      : `${status} ${raw.length > 200 ? `${raw.slice(0, 200)}…` : raw}`;
  const fields = { status, body, headers, message, requestId: headers["x-typesafe-request-id"] };
  switch (status) {
    case 400:
      return new BadRequestError(fields);
    case 401:
      return new AuthenticationError(fields);
    case 403:
      return new PermissionDeniedError(fields);
    case 404:
      return new NotFoundError(fields);
    case 422:
      return new UnprocessableEntityError(fields);
    case 429:
      return new RateLimitError({ ...fields, retryAfterMs });
    default:
      return status >= 500 ? new InternalServerError(fields) : new APIError(fields);
  }
};
