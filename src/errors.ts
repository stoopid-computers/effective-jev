import { Schema } from "effect";
import type { Headers } from "effect/unstable/http";

/** Invalid client configuration, including missing credentials. */
export class TypeSafeConfigError extends Schema.TaggedError<TypeSafeConfigError>()(
  "TypeSafeConfigError",
  { message: Schema.String },
) {}

/** Invalid questions, request options, or a body that cannot be encoded as JSON. */
export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  "InvalidRequestError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

/** A successful HTTP response that does not match the requested answer schema. */
export class ResponseValidationError extends Schema.TaggedError<ResponseValidationError>()(
  "ResponseValidationError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
    requestId: Schema.UndefinedOr(Schema.String),
  },
) {}

/** The transport failed while sending a request or receiving its body. */
export class APIConnectionError extends Schema.TaggedError<APIConnectionError>()(
  "APIConnectionError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

/** An attempt exceeded its timeout, including response body delivery. */
export class APITimeoutError extends Schema.TaggedError<APITimeoutError>()("APITimeoutError", {
  message: Schema.String,
  timeoutMs: Schema.Number,
}) {}

const apiErrorFields = {
  message: Schema.String,
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Unknown,
  requestId: Schema.UndefinedOr(Schema.String),
};

/** An HTTP error without a more specific status tag. */
export class APIError extends Schema.TaggedError<APIError>()("APIError", apiErrorFields) {}
/** HTTP 400. */
export class BadRequestError extends Schema.TaggedError<BadRequestError>()(
  "BadRequestError",
  apiErrorFields,
) {}
/** HTTP 401. */
export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  apiErrorFields,
) {}
/** HTTP 403. */
export class PermissionDeniedError extends Schema.TaggedError<PermissionDeniedError>()(
  "PermissionDeniedError",
  apiErrorFields,
) {}
/** HTTP 404. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  apiErrorFields,
) {}
/** HTTP 422. */
export class UnprocessableEntityError extends Schema.TaggedError<UnprocessableEntityError>()(
  "UnprocessableEntityError",
  apiErrorFields,
) {}
/** HTTP 429, with the server's requested delay in milliseconds when valid. */
export class RateLimitError extends Schema.TaggedError<RateLimitError>()("RateLimitError", {
  ...apiErrorFields,
  retryAfterMs: Schema.UndefinedOr(Schema.Number),
}) {}
/** HTTP 5xx. */
export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  apiErrorFields,
) {}

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
