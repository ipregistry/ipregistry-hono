# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-09

### Added

- `ipregistry()` middleware enriching matched requests with Ipregistry data, attached to the Hono context as the typed `ipregistry` variable (`ContextVariableMap` augmentation included).
- `blockCountries()`, `blockThreats()`, and `redirectByCountry()` composable middleware for country blocking/allowlisting (451), threat and anonymized-traffic blocking (403), and loop-safe country redirects (307/308).
- `getIpregistry(c)` safe reader returning a `no-middleware` context when the middleware did not run.
- Guards: `isEuVisitor` (GDPR, with `assumeEu` fallback), `isThreat` (opt-in proxy/Tor/VPN/relay signals), and `isBot` (local heuristic); all accept the Hono context directly.
- Trusted-proxy IP extraction presets (`auto`, `cloudflare`, `vercel`, `nginx`, `forwarded-for`), single-header sources, and custom extractors (e.g. `getConnInfo`), with sanitization, validation, and private/reserved range detection so private IPs are never sent to the API.
- Runtime-aware configuration through Hono's `env()` adapter: `IPREGISTRY_API_KEY`, `IPREGISTRY_BASE_URL` (with `'eu'` shorthand), `IPREGISTRY_TIMEOUT`, and `IPREGISTRY_FIELDS` work on Node.js, Bun, Deno, and Cloudflare Workers bindings alike.
- Fail-open error handling by default with serializable error info, `failClosed` (503 or custom status), `onError` reporting hook, and anonymized debug logging.
- Credit savers: static-asset skipping (default), opt-in bot skipping (SDK heuristic or custom `RegExp`), custom `skip` predicate, `developmentIp` for localhost, and SDK `InMemoryCache` caching (pluggable or disableable).
- Dual ESM/CJS build, TypeScript declarations, copy-ready examples for Cloudflare Workers and Node.js, and re-exported SDK response types.
