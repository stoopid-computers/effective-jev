# Changelog

## v0.0.4 (2026-09-19)

### Fixes

- Support Deno 2.6.7 and newer with JSR imports and native fetch.
- Read only the SDK's three environment settings in Deno instead of enumerating every variable. Explicit options and custom Effect ConfigProviders keep their precedence; denied permissions return a `TypeSafeConfigError` with the required flag.
- Add Deno installation and permission commands to the README, and run real Deno HTTP tests before releases.
- Wait up to five minutes for accepted registry uploads to become visible, avoiding failed releases caused by npm metadata delays.

## v0.0.3 (2026-09-19)

JSR can now analyze the SDK's public types and generate its declarations and API documentation without the slow-types override.

- Add explicit base-class types for `TypeSafeClient` and the tagged error classes, preserving their Effect service and schema APIs.
- Remove `--allow-slow-types` from JSR validation, publication, and upload tests so CI catches future regressions.

This patch changes type declarations and release checks. Request behavior, imports, and the pinned Effect version stay the same.

## v0.0.2 (2026-09-19)

This patch adds the Effect development tools and tightens numeric validation. The public API and pinned Effect version are unchanged.

- Use finite-number schemas for scores, probabilities, retry jitter, and numeric error fields.
- Replace Biome with Oxfmt and type-aware Oxlint, including Effect's recommended rules for SDK code.
- Patch the native TypeScript compiler and Oxlint with Effect TSGo during installation, and add editor settings for its language server.
- Add ts-reset for development. Published declarations leave consumer global types unchanged.
- Document the development commands and keep tsdown builds, ESM/CommonJS consumer checks, and JSR source checks in the release pipeline.
- Publish to npm through the saved GitHub trusted publisher without a bootstrap token.

## v0.0.1 (2026-09-19)

First release of @compootor/effective-jev, an independent fork of [TypeSafe's JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js). This package starts its own version history at 0.0.1.

- Replace Promise transport with an Effect service, layers, and injectable HttpClient.
- Use Schema for configuration, request, and answer validation and tagged API errors.
- Use Schedule, Clock, Random, and fibers for retries, timeouts, and cancellation.
- Preserve question inference, HTTP endpoints, retry policy overrides, and response metadata.
- Replace custom logging with Effect logging and tracing.
- Rename the npm package to @compootor/effective-jev and pin Effect 4.0.0-rc.112 as a peer dependency.

See the README migration table for the breaking API changes. The original MIT license and TypeSafe copyright notice are preserved. Earlier entries below describe releases of the upstream @typesafe-ai/sdk package.

## v0.6.0 (2026-09-15)

### Breaking changes

- accept `Score.criteria` as an ordered sequence instead of a dictionary keyed by integers

## v0.5.7 (2026-09-11)

This is the initial public release of TypeSafe JavaScript and TypeScript SDK. Learn more in the [documentation](https://docs.typesafe.ai/sdk/javascript).
