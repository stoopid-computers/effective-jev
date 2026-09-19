# Effective Jev

Effect-based Jev for TypeScript nerds.

Ask Jev to choose a label, answer a yes/no question, or score something against a set of levels. Get typed results you can use directly in your application, with validation, retries, and cancellation handled by Effect.

[Quick start](#quick-start) · [Question types](#question-types) · [Common tasks](#common-tasks) · [API reference](#api-reference) · [Migration](#migration) · [Development](#development) · [Releases](#releases) · [Attribution](#attribution)

## Quick start

Use **Node.js 20.19+** or **Deno 2.6.7+**, **Effect `4.0.0-rc.112`**, and a TypeSafe API key. npm includes ESM, CommonJS, and TypeScript declarations; JSR provides TypeScript sources.

### 1. Install the SDK

Both registries use the name `@compootor/effective-jev`.

**Node.js**

```sh
npm install @compootor/effective-jev effect@4.0.0-rc.112
npm install --save-dev tsx
```

**Deno**

```sh
deno add jsr:@compootor/effective-jev npm:effect@4.0.0-rc.112
```

Both commands support the imports in the examples below. Install the exact Effect version shown; the SDK uses v4 APIs that can change between prereleases.

<details>
<summary>Use JSR with Node.js, or test a local checkout</summary>

For JSR, use this instead of the npm package install:

```sh
npx jsr add @compootor/effective-jev
npm install effect@4.0.0-rc.112
npm install --save-dev tsx
```

The examples below use the same `@compootor/effective-jev` import with either registry.

To try local changes before publication, run these commands in the checkout:

```sh
npm ci
npm run release:pack
```

Then install the generated tarball in your application. Replace `VERSION` with the version printed by the packaging command:

```sh
npm install /path/to/release/compootor-effective-jev-VERSION.tgz effect@4.0.0-rc.112
npm install --save-dev tsx
```

</details>

### 2. Set your API key

Get a key from the [TypeSafe dashboard](https://console.typesafe.ai/), then set it in the terminal where you will run your app:

```sh
export TYPESAFE_API_KEY="your-api-key"
```

Keep this key on your server. Browser use exposes it to anyone using the page.

### 3. Ask a question

Save this as `ask.mts`:

```ts
import { Effect } from "effect";
import { choice, TypeSafeClient } from "@compootor/effective-jev";

const program = Effect.gen(function* () {
  const client = yield* TypeSafeClient;

  return yield* client.systemOne({
    state: "I was charged twice. Please help.",
    questions: {
      category: choice("Which team should handle this?", {
        billing: "Payments, invoices, and refunds",
        technical: "Bugs and connection problems",
        other: "Anything else",
      }),
    },
  });
});

const result = await Effect.runPromise(program.pipe(Effect.provide(TypeSafeClient.layerFetch())));

console.log(result.answers.category.choice);
// TypeScript knows this is "billing" | "technical" | "other".
```

Run it with Node.js:

```sh
npx tsx ask.mts
```

Or with Deno:

```sh
deno run --check \
  --allow-net=api.typesafe.ai \
  --allow-env=TYPESAFE_API_KEY,TYPESAFE_BASE_URL,TYPESAFE_DEFAULT_MODEL \
  ask.mts
```

Deno only needs network access to the API host and read access to those three settings. If you set a custom `baseURL`, allow its host instead. Explicit client options skip their environment reads. Providing all three options, or your own `ConfigProvider`, removes the SDK's need for `--allow-env`.

You will see one of your labels, such as `billing`. The answer also includes confidence and a probability for each label. All answers come with the model name and token usage.

`yield*` runs each step. `layerFetch()` supplies the configured client and HTTP transport. `Effect.runPromise` runs the whole program so you can `await` its result.

Creating an Effect sends nothing. Running the same Effect twice sends two requests.

## Question types

Choose a question by the answer you need. You can mix all three in one request.

| You need                               | Helper   | Answer                                                      |
| -------------------------------------- | -------- | ----------------------------------------------------------- |
| One label from a known set             | `choice` | Selected label, confidence, and probabilities               |
| The probability that something is true | `noul`   | A number from `0` for no to `1` for yes                     |
| A rating across ordered levels         | `score`  | A score, confidence, probabilities, and the original levels |

```ts
import { choice, noul, score } from "@compootor/effective-jev";

const questions = {
  category: choice("Which team should handle this?", {
    billing: null,
    technical: null,
    other: null,
  }),
  urgent: noul("Does the customer need help today?"),
  frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Angry"]),
};
```

Use this as the `questions` field in the quick start. Your keys become the answer keys: `answers.category`, `answers.urgent`, and `answers.frustration`.

A choice needs at least one label. Use `null` when a label needs no description. A score needs at least two levels, numbered from zero. With the three levels above, its answer can be any number from `0` to `2`, including decimals.

`state` is the context Jev evaluates. It accepts text, a JSON object, a JSON array, or `null`. Instructions and level descriptions accept those same formats. Ask independent questions together; each sees the state, but cannot use another question's answer from the same call.

## Common tasks

### Configure the client once

Keep shared settings in a layer, then pass it to `Effect.provide` when you run your program:

```ts
import { TypeSafeClient } from "@compootor/effective-jev";

const ClientLive = TypeSafeClient.layerFetch({
  defaultModel: "jev-latest",
  timeout: 10_000,
  retry: { maxRetries: 2 },
  defaultHeaders: { "x-my-app": "support" },
});
```

Use `program.pipe(Effect.provide(ClientLive))` in the quick start. The API key still comes from `TYPESAFE_API_KEY`. [All configuration options](#client-options) are listed below.

### List models or read response metadata

```ts
import { Effect } from "effect";
import { TypeSafeClient } from "@compootor/effective-jev";

const program = TypeSafeClient.use((client) => client.models.listWithResponse());

const { data, response, requestId } = await Effect.runPromise(
  program.pipe(Effect.provide(TypeSafeClient.layerFetch())),
);

console.log(data, response.status, requestId);
const rawBody = await Effect.runPromise(response.json);
```

`data` is the validated model list. `response` gives you HTTP status, headers, and the cached body. Use `models.list()` when you only need the data, or `systemOneWithResponse(request)` for evaluation results with the same metadata.

### Handle an error

Use `Effect.catchTag` to handle a specific failure. Other failures continue to the caller.

```ts
import { Effect } from "effect";
import { TypeSafeClient } from "@compootor/effective-jev";

const program = TypeSafeClient.use((client) => client.models.list()).pipe(
  Effect.tap((models) => Effect.log(models)),
  Effect.catchTag("AuthenticationError", () =>
    Effect.logError("Replace TYPESAFE_API_KEY with a valid TypeSafe key."),
  ),
);

await Effect.runPromise(program.pipe(Effect.provide(TypeSafeClient.layerFetch())));
```

See [errors](#errors) for every error tag and what to do about it.

### Set a total time limit or cancel a request

The client's `timeout` applies to each attempt, including body delivery. Retries start a fresh timeout. To limit the whole operation, add `Effect.timeout`:

```ts
import { Effect } from "effect";
import { TypeSafeClient } from "@compootor/effective-jev";

const program = TypeSafeClient.use((client) => client.models.list()).pipe(
  Effect.timeout("15 seconds"),
  Effect.provide(TypeSafeClient.layerFetch()),
);

const controller = new AbortController();
const pending = Effect.runPromise(program, { signal: controller.signal });
// Call controller.abort() when the caller cancels.
const models = await pending;
```

Cancelling the running Effect aborts the active request or retry wait. It remains Effect cancellation and is never retried. `Effect.timeout` adds Effect's own `TimeoutError`; the SDK's per-attempt limit uses `APITimeoutError`.

### Use your own HTTP client, configuration, or logger

`TypeSafeClient.layer()` lets you supply an Effect HTTP client yourself:

```ts
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { TypeSafeClient } from "@compootor/effective-jev";

const ClientLive = TypeSafeClient.layer().pipe(Layer.provide(FetchHttpClient.layer));
```

For a custom `fetch`, provide `Layer.succeed(FetchHttpClient.Fetch, customFetch)` to `FetchHttpClient.layer` or `TypeSafeClient.layerFetch()`. For tests, provide `Layer.succeed(HttpClient.HttpClient, mockClient)`, where `mockClient` comes from `HttpClient.make`.

Configuration reads through Effect's `ConfigProvider`, so you can replace environment variables with your own provider. Logging uses `Effect.logDebug`; enable it with `Effect.provideService(References.MinimumLogLevel, "Debug")`, or supply `Logger.layer` for custom output. Request spans use Effect tracing. SDK logs record the method, path, status, request ID, and attempt number.

---

## API reference

[Client](#create-and-access-a-client) · [Methods](#client-methods) · [Helpers](#question-helpers) · [Data](#requests-and-results) · [Configuration](#client-options) · [Request options](#per-request-options) · [Retries](#retry-options) · [Errors](#errors) · [Schemas and types](#schemas-constants-and-types)

Import values and types from `@compootor/effective-jev`. Methods return an `Effect`: use `yield*` inside `Effect.gen`, or run a fully configured program with `Effect.runPromise`.

### Create and access a client

| API                                   | Use it when                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `TypeSafeClient.layerFetch(options?)` | You want the default fetch transport. Start here.                                |
| `TypeSafeClient.layer(options?)`      | You supply an Effect `HttpClient` through `Layer.provide`.                       |
| `TypeSafeClient.make(options?)`       | You want the client directly inside an Effect. An `HttpClient` must be provided. |
| `yield* TypeSafeClient`               | You need the configured client inside `Effect.gen`.                              |
| `TypeSafeClient.use(client => ...)`   | You want to call the service without writing a generator.                        |

The resulting `TypeSafeClientService` exposes `baseURL`, `defaultModel`, and the methods below. Creating it can fail with `TypeSafeConfigError`.

### Client methods

| Method                                     | Successful result                        | HTTP endpoint        |
| ------------------------------------------ | ---------------------------------------- | -------------------- |
| `systemOne(request, options?)`             | `SystemOneResult<Q>`                     | `POST /v1/systemone` |
| `systemOneWithResponse(request, options?)` | `WithResponse<SystemOneResult<Q>>`       | `POST /v1/systemone` |
| `models.list(options?)`                    | `ReadonlyArray<ModelCard>`               | `GET /v1/models`     |
| `models.listWithResponse(options?)`        | `WithResponse<ReadonlyArray<ModelCard>>` | `GET /v1/models`     |

Each returns `Effect<Result, TypeSafeError>`. `Q` is your questions object; TypeScript uses it to infer the answer keys and values.

### Question helpers

| Signature                        | Returns             | Arguments                                                                            |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `choice(instructions, criteria)` | `ChoiceQuestion<T>` | A nonempty map of labels to descriptions                                             |
| `noul(instructions?, criteria?)` | `NoulQuestion`      | Instructions default to `null`. Optional criteria describe `true`, `false`, or both. |
| `score(instructions, criteria)`  | `ScoreQuestion<T>`  | An array of at least two descriptions, ordered from lowest to highest                |

Instructions and descriptions accept `EntryType`: text, JSON objects, JSON arrays, or `null`. Noul criteria may also be `null`. Helpers create plain objects with `type`, `instructions`, and `criteria`; you may write these objects yourself. Validation happens when the request runs.

### Requests and results

`SystemOneRequest<Q>` has three fields:

| Field       | Required | Meaning                                                |
| ----------- | -------- | ------------------------------------------------------ |
| `state`     | Yes      | The text or structured context to evaluate             |
| `questions` | Yes      | A nonempty object of named questions                   |
| `model`     | No       | Overrides the client's `defaultModel` for this request |

Extra fields on a request variable are forwarded. Explicit `null` values are preserved. The SDK snapshots the encoded request so every retry sends the same body.

`SystemOneResult<Q>` contains `model`, `answers`, and `usage`. Answers use the names you supplied in `questions`:

| Answer type         | Fields                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `NoulResponse`      | `type: "noul"`, `noul` from `0` to `1`                                                     |
| `ChoiceResponse<T>` | `type: "choice"`, `choice`, `confidence`, and `probabilities` keyed by your labels         |
| `ScoreResponse<T>`  | `type: "score"`, `score`, `confidence`, `probabilities`, and `legend` keyed by level index |

Confidence and probabilities range from `0` to `1`. Score legends map each index back to its original description. `usage` contains non-negative integer `input_tokens` and `output_tokens`. Returned data is readonly in TypeScript.

The SDK checks answer keys, question kinds, label names, numeric ranges, and score legends before returning data. A malformed successful response fails with `ResponseValidationError`.

`ModelCard` contains three strings: `name`, `description`, and `release_date`.

`WithResponse<A>` contains `data: A`, `response: HttpClientResponse`, and `requestId: string | undefined`. The request ID comes from `x-typesafe-request-id`. The full body is read within the attempt's timeout; `response.text` and `response.json` remain readable as Effects afterward, including fields omitted from the decoded result.

### Client options

All fields in `TypeSafeClientConfig` are optional. Explicit values win over configuration-provider values, then SDK defaults.

| Option                    | Default                                             | Meaning                                                               |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `apiKey`                  | `TYPESAFE_API_KEY`                                  | Required credential. Accepts a string or `Redacted.Redacted<string>`. |
| `baseURL`                 | `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai` | HTTP or HTTPS root URL, without credentials, a query, or a fragment   |
| `defaultModel`            | `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`         | Model used when the request omits `model`                             |
| `timeout`                 | `10000`                                             | Positive milliseconds allowed per attempt                             |
| `retry`                   | [Retry defaults](#retry-options)                    | Partial `RetryPolicy` override                                        |
| `defaultHeaders`          | `{}`                                                | Additional string-valued headers                                      |
| `dangerouslyAllowBrowser` | `false`                                             | Allow browser use, which exposes the API key to page users            |

Environment values are trimmed. Blank optional values use the default; a missing or blank API key fails. Explicit keys are held in Effect's `Redacted` wrapper.

### Per-request options

Pass `RequestOptions` as the second argument to `systemOne` or `systemOneWithResponse`, or the first argument to a model-list method.

| Option    | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| `timeout` | Override the per-attempt timeout in milliseconds                  |
| `retry`   | Override only the supplied retry fields; inherit the rest         |
| `headers` | Merge with default headers, matching names without regard to case |

Per-request headers win over defaults. SDK-controlled authorization, JSON, identification, and retry-count headers take precedence over both. Pass cancellation signals to `Effect.runPromise`, not to these methods.

### Retry options

| `RetryPolicy` field  | Default                           | Meaning                                                                        |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `maxRetries`         | `2`                               | Retries after the first attempt. `0` disables retries.                         |
| `backoffInitialMs`   | `500`                             | First delay before a retry                                                     |
| `backoffMaxMs`       | `5000`                            | Upper limit as the delay doubles after each failure                            |
| `backoffJitter`      | `0.25`                            | Randomly subtract up to this fraction of the delay. Valid range is `0` to `1`. |
| `httpStatuses`       | `408`, `429`, `500` through `599` | A `ReadonlySet<number>` of retryable statuses                                  |
| `respectRetryAfter`  | `true`                            | Honor the server's requested retry delay                                       |
| `maxRetryAfterMs`    | `60000`                           | Maximum server delay to honor; larger values fall back to normal backoff       |
| `apiConnectionError` | `true`                            | Retry connection failures, including interrupted body delivery                 |
| `apiTimeoutError`    | `true`                            | Retry per-attempt timeouts                                                     |

`retry-after-ms` takes precedence over `Retry-After`, which accepts seconds or an HTTP date. Valid server delays are used without jitter. Counts must be non-negative integers and delay settings must be finite, non-negative numbers. Request validation failures, response validation failures, and cancellation are not retried.

### Errors

Each error is an exported class with a `_tag` matching its name and a `message`. Handle it with `Effect.catchTag`.

| Error tag                  | What to check                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TypeSafeConfigError`      | API key, base URL, model, or configuration values                                                                 |
| `InvalidRequestError`      | Questions, JSON input, or per-request settings                                                                    |
| `ResponseValidationError`  | The server returned data that does not match the expected shape. Keep its `requestId` when reporting the problem. |
| `APIConnectionError`       | Network or service reachability                                                                                   |
| `APITimeoutError`          | The attempt exceeded `timeoutMs`; check latency or increase the timeout                                           |
| `BadRequestError`          | HTTP `400`: request or model selection                                                                            |
| `AuthenticationError`      | HTTP `401`: replace an invalid API key                                                                            |
| `PermissionDeniedError`    | HTTP `403`: account access                                                                                        |
| `NotFoundError`            | HTTP `404`: endpoint or resource                                                                                  |
| `UnprocessableEntityError` | HTTP `422`: validation details in the response body                                                               |
| `RateLimitError`           | HTTP `429`: wait or reduce request volume                                                                         |
| `InternalServerError`      | HTTP `5xx`: service failure, retried by default                                                                   |
| `APIError`                 | Any other unsuccessful HTTP status                                                                                |

HTTP errors expose `status`, `headers`, `body`, and optional `requestId`. `RateLimitError` also exposes `retryAfterMs` when the server supplied a valid delay. `ResponseValidationError` and `APIConnectionError` retain their underlying `cause`; `InvalidRequestError` includes it when available.

`APIResponseError` is the union of HTTP error types. `TypeSafeError` adds request validation, response validation, connection, and per-attempt timeout errors. Configuration errors are separate because they happen when the client is created. Cancellation remains an Effect interruption.

### Schemas, constants, and types

`Schemas` contains Effect Schema values for validating data outside the client:

| Export                               | Validates                                                      |
| ------------------------------------ | -------------------------------------------------------------- |
| `Schemas.Entry`                      | State, instructions, or descriptions                           |
| `Schemas.Question`                   | Any supported question shape                                   |
| `Schemas.SystemOneRequest`           | A request with its required model already supplied             |
| `Schemas.systemOneResult(questions)` | A result matching those question IDs, labels, and score levels |
| `Schemas.Probability`                | A number from `0` to `1`                                       |
| `Schemas.Usage`                      | Input and output token counts                                  |
| `Schemas.Model`                      | One model card                                                 |
| `Schemas.Models`                     | The HTTP response shape `{ models: [...] }`                    |

Defaults are exported as `DEFAULT_BASE_URL`, `DEFAULT_MODEL`, `DEFAULT_TIMEOUT_MS`, and `DEFAULT_RETRY_POLICY`. `VERSION` is the SDK version. `ENV.apiKey`, `ENV.baseURL`, and `ENV.defaultModel` hold the environment-key names listed above.

<details>
<summary>Exported TypeScript types</summary>

| Group                | Types                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| JSON values          | `JsonValue`, `EntryType`, `Description`                                                                         |
| Questions            | `Question`, `Questions`, `NoulQuestion`, `ChoiceQuestion<T>`, `ScoreQuestion<T>`                                |
| Criteria             | `ChoiceCriteria`, `ScoreCriteria`                                                                               |
| Answers              | `ResultFor<T>`, `NoulResponse`, `ChoiceResponse<T>`, `ScoreResponse<T>`, `ScoreOf<T>`, `ScoreLegend<T>`         |
| Requests and results | `SystemOneRequest<Q>`, `SystemOneRequestPayload`, `SystemOneResult<Q>`, `Usage`, `ModelCard`, `WithResponse<A>` |
| Client and settings  | `TypeSafeClientService`, `Models`, `TypeSafeClientConfig`, `RequestOptions`, `RetryPolicy`, `EnvVar`            |
| Errors               | `TypeSafeError`, `APIResponseError`                                                                             |

`ResultFor<T>` maps a question to its answer type. `ScoreOf<T>` gives the index keys for a score's levels, and `ScoreLegend<T>` maps those keys to descriptions. Literal score arrays preserve exact index keys; variable-length arrays use numeric indexing. `SystemOneRequestPayload` is a request whose `model` is required.

</details>

## Migration

This fork replaces the Promise-based API in the upstream `@typesafe-ai/sdk`.

| Previously                                 | Now                                                           |
| ------------------------------------------ | ------------------------------------------------------------- |
| `new TypeSafeClient(options)`              | Provide `TypeSafeClient.layerFetch(options)` to your program  |
| `await client.systemOne(...)`              | `yield* client.systemOne(...)` inside `Effect.gen`            |
| `.withResponse()`                          | `systemOneWithResponse(...)` or `models.listWithResponse()`   |
| `.asResponse()`                            | Read `response` from a `WithResponse` result after validation |
| Promise `.map(fn)`                         | `Effect.map(fn)`                                              |
| Per-call `signal` or `APIUserAbortError`   | Cancel the Effect, or pass `signal` to `Effect.runPromise`    |
| Error-class inheritance                    | Match the error's tag with `Effect.catchTag`                  |
| `fetch` constructor option                 | Supply an Effect `HttpClient` or `FetchHttpClient.Fetch`      |
| `logger`, `logLevel`, `TYPESAFE_LOG_LEVEL` | Effect Logger and `References.MinimumLogLevel`                |

Question helpers now return plain values; invalid inputs fail when the request Effect runs. Successful HTTP responses are checked before being returned. Question names, label inference, endpoints, and request `null` values are preserved.

## Development

Install Node.js 24, npm 11.19.0, and Deno 2.6.7 or newer, then run:

```sh
npm ci
npm run check
```

| Command                | What it does                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run build`        | Bundle ESM, CommonJS, source maps, and declarations into `dist/` with [tsdown](https://tsdown.dev/) |
| `npm run typecheck`    | Check types without emitting files, using the native TypeScript 7 compiler                          |
| `npm run lint`         | Run type-aware Oxlint and Effect diagnostics                                                        |
| `npm run lint:fix`     | Apply available safe lint fixes                                                                     |
| `npm run format`       | Format with Oxfmt                                                                                   |
| `npm run format:check` | Check formatting without changing files                                                             |
| `npm run test:deno`    | Type-check and run the SDK in Deno with a local HTTP server and restricted permissions              |

`npm ci` runs [Effect's TSGo patcher](https://github.com/Effect-TS/tsgo) for TypeScript and Oxlint. Their versions are pinned together because the patches require compatible binaries. Effect's recommended rules apply to the SDK and example; correctness checks also cover tests and release scripts.

For VS Code or Cursor, install the recommended **TypeScript 7** and **Oxc** extensions, select the workspace TypeScript version, and reload the editor. The workspace settings enable the patched language server and format on save. Oxlint reports Effect diagnostics; the language server provides navigation, completions, and refactors.

[ts-reset](https://www.totaltypescript.com/ts-reset) tightens global types during development through `types/reset.d.ts`. This file stays outside the published sources and declarations, so importing the SDK does not change your application's global types.

`check` runs formatting, lint, type checks, metadata checks, release-tool tests, SDK tests with coverage, Deno tests, builds, ESM/CommonJS smoke tests, and package validation. Tests use injected clients and a local HTTP server. CI tests Deno 2.6.7 and 2.9.7; Deno checks also run before publishing.

`npm run demo` makes a real request using `TYPESAFE_API_KEY`. `npm run test:integration` runs live API tests when that key is set. Both use your account's API quota. `npm pack` builds a fresh local archive. `npm run release:pack` also checks JSR, tests a clean installation, and writes release files to `release/`. Neither command publishes anything.

## Releases

This package starts its own version history at **0.0.1**. npm and JSR always receive the same name, version, and source commit. Release tooling uses Node.js 24 and npm 11.19.0.

### Versions and branches

Use `release/<major>.<minor>` for each release line. The first is `release/0.0`; a future `1.2.3` belongs on `release/1.2`. `main`, `staging`, and `dev` run checks only. They cannot publish.

| Change                             | Version rule                                   |
| ---------------------------------- | ---------------------------------------------- |
| Compatible bug fix                 | Increase the patch, such as `0.0.1` to `0.0.2` |
| New feature before 1.0             | Increase the minor, such as `0.0.2` to `0.1.0` |
| Breaking change before 1.0         | Increase the minor and explain the migration   |
| Compatible feature from 1.0 onward | Increase the minor                             |
| Breaking change from 1.0 onward    | Increase the major                             |
| Test release                       | Add a prerelease suffix, such as `0.1.0-rc.1`  |

Use exact [SemVer](https://semver.org/) versions without build metadata. The tooling checks version agreement and ordering; maintainers choose the bump based on the API change. Upstream SDK versions do not belong to this package's release history.

New stable releases use npm's `latest` tag. Prereleases use `next` and become GitHub prereleases. A release older than the newest published version uses its own channel, such as `release-0.0` or `release-0.0-next`, so it cannot move `latest` or `next` backwards. JSR selects stable versions by SemVer and keeps prereleases out of normal version ranges.

### One-time registry setup

The repository is `stoopid-computers/effective-jev`; the publishing scope is `@compootor` on both registries.

1. Ensure the publishing account can manage `@compootor/effective-jev` in npm's `@compootor` organization.
2. Configure npm's trusted publisher with owner `stoopid-computers`, repository `effective-jev`, workflow `publish.yml`, and environment `release`. Allow direct `npm publish`. This connection is already configured for this repository. Releases use GitHub's temporary OIDC credentials and require no `NPM_TOKEN` secret. See [npm's setup instructions](https://docs.npmjs.com/trusted-publishers/).
3. Create `@compootor/effective-jev` on JSR and link it to `stoopid-computers/effective-jev` in the package settings. GitHub Actions then publishes without a JSR token. See [JSR's setup instructions](https://jsr.io/docs/publishing-packages#publishing-from-github-actions).
4. Configure the GitHub `release` environment to allow version tags matching `v*`. Protect the `release/**` branches and `v*` tags against deletion or force updates. Only maintainers who can approve releases should be able to push release tags.

The workflow must be present on the repository's default branch for manual runs to appear in GitHub Actions. Publishing still requires a version tag whose commit belongs to the matching release branch.

### Cut a release

Start from a committed, reviewed change. For the first release:

```sh
git switch -c release/0.0
npm ci
npm run release:pack
npm run release:check
git push -u origin release/0.0
```

The branch push runs a dry run and uploads the package, checksums, and release metadata. It publishes nothing. Review the successful **Release** run, then tag that same commit:

```sh
git tag -a v0.0.1 -m "Release v0.0.1"
git push origin v0.0.1
```

For the next patch, write its release notes in `/tmp/effective-jev-notes.md`, then prepare the version on the same branch:

```sh
npm run release:prepare -- 0.0.2 --notes /tmp/effective-jev-notes.md
npm run release:pack
git add package.json package-lock.json jsr.json src/version.ts docs/changelog.md
git commit -m "Release v0.0.2"
npm run release:check
git push origin release/0.0
```

After that branch's dry run passes, tag and push `v0.0.2` using the same two tag commands above. For a new minor or major, create its matching release branch before running `release:prepare`. Prereleases use the same process with a version such as `0.1.0-rc.1`.

`release:prepare` updates the manifests, lockfile, runtime version, and changelog together. `release:check` requires a clean tree, matching branch and version, and complete release notes.

A version-tag push runs the full checks again, publishes the tested npm archive and matching JSR sources, verifies both registries, then creates the GitHub Release. Its attachments include the tarball, `SHA256SUMS`, release metadata, and hashes for the original sources and JSR upload. The build job has no publishing permission; the publishing job verifies the downloaded artifact against the tagged commit.

### Retry a partial release

If one registry succeeds and the other fails, rerun the failed **Release** workflow for the same tag. You can also run it manually on that tag with `dry_run` disabled. Existing npm versions must have the same tarball integrity; existing JSR versions must have identical file hashes. A mismatch stops the release and requires a new version.

Registry publication is not atomic. One registry can become available before the other; the GitHub Release appears only after both verify. Keep published tags and versions unchanged.

## Attribution

Effective Jev is an independent fork of [TypeSafe's JavaScript and TypeScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js), originally authored by [evinism](https://github.com/evinism) and published as `@typesafe-ai/sdk`. This fork rewrites the client with Effect v4 and maintains its own releases as `@compootor/effective-jev`.

The original **Copyright (c) 2026 TypeSafe** notice and full MIT license are preserved in [LICENSE](LICENSE), which ships in both registry packages. The changelog labels the inherited upstream releases separately.
