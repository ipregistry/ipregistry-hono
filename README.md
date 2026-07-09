[<img src="https://cdn.ipregistry.co/icons/favicon-96x96.png" alt="Ipregistry" width="64"/>](https://ipregistry.co/)

# Ipregistry Hono Library

[![License](http://img.shields.io/:license-apache-blue.svg)](LICENSE.txt)
[![Actions Status](https://github.com/ipregistry/ipregistry-hono/workflows/CI/badge.svg)](https://github.com/ipregistry/ipregistry-hono/actions)
[![npm](https://img.shields.io/npm/v/@ipregistry/hono.svg)](https://www.npmjs.com/package/@ipregistry/hono)

This is the official [Hono](https://hono.dev) integration for the [Ipregistry](https://ipregistry.co) IP geolocation and threat data API. It is built on top of the official [`@ipregistry/client`](https://github.com/ipregistry/ipregistry-javascript) JavaScript SDK.

The `ipregistry()` middleware enriches every matched request with Ipregistry data and attaches it to the Hono context. Downstream middleware and handlers read it with `c.var.ipregistry` — fully typed, no extra call, no extra credit. Because both the middleware and the SDK only use Web APIs, it runs wherever Hono runs: Cloudflare Workers, Bun, Deno, Node.js, and more.

```
Request -> ipregistry() middleware (1 lookup, cached) -> c.var.ipregistry anywhere downstream
```

## Features

- One middleware, data everywhere: a single lookup per request, readable from any downstream middleware or handler as a typed context variable.
- Built-in caching through the SDK's LRU cache, so repeated visits from the same IP do not consume additional credits.
- Country blocking, threat/proxy/Tor blocking, and country redirects as composable one-line middleware.
- GDPR helper (`isEuVisitor`) based on the API's `location.in_eu` field.
- Safe by default: fails open when Ipregistry is unreachable, skips static assets, never sends private IP addresses to the API, and never logs full IP addresses.
- Trusted-proxy IP extraction presets for Cloudflare, Vercel, and Nginx, plus custom extractors (e.g. your runtime's `getConnInfo`).
- Runtime-aware configuration: environment variables are resolved with Hono's `env()` adapter, so Cloudflare Workers bindings work exactly like `process.env`.
- TypeScript-first, with `ContextVariableMap` augmentation for `c.var.ipregistry` and the official SDK's response types re-exported.

## Getting started

You need an Ipregistry API key. Sign up at [https://ipregistry.co](https://ipregistry.co) to get one along with free lookups.

### Requirements

- Hono 4 or newer.
- Any runtime with the `fetch` Web API: Cloudflare Workers, Bun, Deno, Node.js 22+, Vercel, AWS Lambda...

### Installation

```sh
npm install @ipregistry/hono
```

### Setup in two steps

1. Provide your API key as the `IPREGISTRY_API_KEY` environment variable. On Cloudflare Workers, add it as a secret:

    ```sh
    npx wrangler secret put IPREGISTRY_API_KEY
    ```

    On Node.js, Bun, or Deno, export it in the environment (or a `.env` file loaded by your platform).

2. Register the middleware and read the data anywhere downstream:

    ```ts
    import { Hono } from 'hono'
    import { ipregistry } from '@ipregistry/hono'

    const app = new Hono()

    app.use(ipregistry({ fields: 'ip,location,security' }))

    app.get('/', (c) => {
        const { data } = c.var.ipregistry
        return c.text(`Hello ${data?.location?.country?.name ?? 'visitor'}!`)
    })

    export default app
    ```

The `ipregistry` context variable holds an `IpregistryContext`:

```ts
interface IpregistryContext {
    ip: string | null // the client IP used for the lookup
    data: IpInfo | null // the Ipregistry payload, or null if skipped/failed
    skipped?: 'static-asset' | 'bot' | 'custom' | 'no-ip' | 'no-middleware'
    error?: { code?: string; message: string }
}
```

In shared helpers that cannot know whether the middleware ran, prefer `getIpregistry(c)`: it never throws and returns a `no-middleware` context instead of `undefined`.

## Configuration

All options are optional. Explicit options take precedence over environment variables, which are resolved per runtime with Hono's `env()` adapter (Workers bindings, `process.env`, `Deno.env`).

| Option             | Environment variable  | Default              | Description                                                                                                                                 |
| ------------------ | --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`           | `IPREGISTRY_API_KEY`  | —                    | Your Ipregistry API key.                                                                                                                    |
| `baseUrl`          | `IPREGISTRY_BASE_URL` | Default API endpoint | API base URL. The shorthand `'eu'` selects the European Union endpoint. Use a full URL for private deployments.                             |
| `cache`            | —                     | SDK `InMemoryCache`  | Any SDK `IpregistryCache` implementation, or `false` to disable caching.                                                                    |
| `client`           | —                     | —                    | A pre-configured `IpregistryClient`, replacing all connection options. Useful for tests.                                                    |
| `debug`            | —                     | `false`              | Log skipped and failed lookups with `console.warn`. IP addresses are anonymized.                                                            |
| `developmentIp`    | —                     | —                    | Fixed public IP substituted when the client IP is missing or private (the norm on localhost). Leave unset in production.                    |
| `failClosed`       | —                     | `false`              | Respond with 503 (or a custom status number) when the lookup fails, instead of failing open.                                                |
| `fields`           | `IPREGISTRY_FIELDS`   | Full response        | Comma-separated response field selection, e.g. `ip,location,security`. Fewer fields mean faster lookups and smaller payloads.               |
| `hostname`         | —                     | `false`              | Resolve the hostname of the client IP (slower lookups).                                                                                     |
| `ipSource`         | —                     | `'auto'`             | Where to read the client IP from: a preset, `{ header: '...' }`, or a custom extractor. See [IP extraction](#ip-extraction-behind-proxies). |
| `maxRetries`       | —                     | `0`                  | Automatic retries. Kept at 0 so failures never stall responses.                                                                             |
| `onError`          | —                     | —                    | `(error, c) => void` callback for reporting lookup failures to your monitoring.                                                             |
| `skip`             | —                     | —                    | `(c) => boolean` custom predicate to skip the lookup for a request.                                                                         |
| `skipBots`         | —                     | `false`              | Skip lookups for bots: `true` uses the SDK heuristic, or pass a `RegExp` tested against the User-Agent.                                     |
| `skipStaticAssets` | —                     | `true`               | Skip lookups for favicon and common static file extensions.                                                                                 |
| `timeout`          | `IPREGISTRY_TIMEOUT`  | `3000` (ms)          | Lookup timeout. Lower than the SDK default because the lookup sits on the request path.                                                     |

> Tip: always set `fields`. A full Ipregistry response is several kilobytes; `ip,location,security` covers geo-blocking, threat-blocking, and GDPR use cases with a fraction of the payload.

## Blocking countries

```ts
import { blockCountries, ipregistry } from '@ipregistry/hono'

app.use(ipregistry({ fields: 'ip,location' }))
app.use(blockCountries({ countries: ['KP', 'IR'] }))
```

Blocked visitors receive a `451 Unavailable For Legal Reasons` plain-text response. Options:

- `mode: 'allow'` denies every country except the listed ones.
- `unknown: 'block'` also blocks visitors whose country could not be determined (default is `'allow'`, fail-open).
- `status` and `response: (c, context) => Response` customize the response.

Like all blockers, `blockCountries` can be scoped to a subset of routes:

```ts
app.use('/store/*', blockCountries({ countries: ['US', 'CA'], mode: 'allow' }))
```

## Blocking proxies, Tor, and threats

```ts
import { blockThreats, ipregistry } from '@ipregistry/hono'

app.use(ipregistry({ fields: 'ip,security' }))
app.use(blockThreats({ proxy: true, tor: true, vpn: true }))
```

Visitors flagged as `is_threat`, `is_attacker`, or `is_abuser` are always blocked with a `403`. Anonymization signals (`proxy`, `tor`, `vpn`, `relay`, `anonymous`, `cloudProvider`, `bogon`) are opt-in, because they also match legitimate privacy-conscious users. Skipped or failed lookups pass through (fail-open).

For custom decisions, write a plain Hono middleware — the data is on the context:

```ts
app.use(async (c, next) => {
    if (c.var.ipregistry.data?.security?.is_tor) {
        return c.text('Not available over Tor.', 403)
    }
    await next()
})
```

## Country-based redirects

```ts
import { ipregistry, redirectByCountry } from '@ipregistry/hono'

app.use(ipregistry({ fields: 'ip,location' }))
app.use(
    redirectByCountry({
        redirects: { FR: '/fr', DE: 'https://example.de' },
        preservePath: true,
    }),
)
```

Redirects default to `307` so browsers do not cache a geo decision; use `status: 308` for permanent country domains. The middleware never redirects visitors already under the destination, so it is loop-safe.

## GDPR and EU detection

```ts
import { isEuVisitor } from '@ipregistry/hono'

app.get('/', (c) => {
    if (isEuVisitor(c)) {
        // show the cookie consent banner
    }
    // ...
})
```

`isEuVisitor` is based on the API's `location.in_eu` field and accepts the Hono context, an `IpregistryContext`, or raw `IpInfo` data. When the data is missing it returns `false` (fail-open); pass `{ assumeEu: true }` for a conservative GDPR stance that treats unknown visitors as EU visitors.

`isThreat(c, options)` and `isBot(c)` follow the same pattern. `isBot` is a purely local User-Agent heuristic that never calls the API.

## Caching

Lookups are cached with the SDK's in-memory LRU cache (2048 entries, 10-minute expiry) shared across requests handled by the same runtime instance, so repeat visits from the same IP do not consume additional credits. On serverless platforms the cache lives as long as the instance (isolate, worker, lambda) does.

Plug any `IpregistryCache` implementation to use a shared store, or disable caching entirely:

```ts
app.use(ipregistry({ cache: false }))
```

## IP extraction behind proxies

The middleware reads the client IP from proxy headers. Only trust headers your platform actually overwrites — otherwise clients can spoof their IP:

- `auto` (default): `cf-connecting-ip`, then `x-real-ip`, then the first `x-forwarded-for` entry. Works out of the box on Cloudflare Workers and most managed platforms.
- `cloudflare`: `cf-connecting-ip` only. Pin this when you are exclusively behind Cloudflare.
- `vercel`: `x-real-ip`, then `x-vercel-forwarded-for`, then `x-forwarded-for`.
- `nginx`: `x-real-ip` (set via `proxy_set_header X-Real-IP $remote_addr;`), then `x-forwarded-for`.
- `forwarded-for`: the first `x-forwarded-for` entry only.
- `{ header: 'x-client-ip' }`: a single custom trusted header.

When the server is directly exposed with no proxy in front, pass your runtime's `getConnInfo` helper directly — custom extractors may return a bare IP string or a Hono `ConnInfo`, the same contract as Hono's built-in `ipRestriction` middleware:

```ts
import { getConnInfo } from 'hono/bun' // or 'hono/deno', 'hono/cloudflare-workers'
// Node.js: import { getConnInfo } from '@hono/node-server/conninfo'

app.use(ipregistry({ ipSource: getConnInfo }))
```

Private and reserved addresses (RFC 1918, loopback, link-local, CGNAT, unique-local IPv6...) are never sent to the API: the lookup is skipped with the `no-ip` reason. On localhost, set `developmentIp` to a fixed public IP to exercise geo features during development.

## Saving credits on bots and static assets

Static asset paths (favicon and common file extensions) are skipped by default. Bots are not, because bot traffic is often exactly what you want to inspect; opt in with:

```ts
app.use(ipregistry({ skipBots: true }))
```

or pass a `RegExp` for your own bot list, and `skip: (c) => boolean` for anything else. Skipped requests never call the API and carry the skip reason in `c.var.ipregistry.skipped`.

## Error handling

The middleware fails open by default: when a lookup fails (timeout, quota exceeded, invalid key, network error), the request proceeds with `data: null` and a serializable `error` on the context — never a thrown exception, never a stack trace, never a full IP in the logs.

```ts
app.use(
    ipregistry({
        onError: (error, c) => reportToMonitoring(error),
        // failClosed: true, // respond 503 instead of proceeding without data
    }),
)
```

Blocked requests follow the same convention as Hono's built-in `ipRestriction` and `timeout` middleware: the blockers and `failClosed` throw an `HTTPException` carrying a ready plain-text response, so your `app.onError` can observe, log, or rebrand every denial in one place — or you can bypass the exception entirely with the `response` option.

Blocking middleware is deliberately loud about one more case: if `blockCountries`, `blockThreats`, or `redirectByCountry` runs without the `ipregistry()` middleware registered before it, it throws a plain error (visible in your logs as a 500) — a silently inactive blocker would be a security hole.

## Typed context variables

Importing the package augments Hono's `ContextVariableMap`, so `c.var.ipregistry` and `c.get('ipregistry')` are typed automatically. If you prefer explicit typing (for example in shared sub-apps), use the exported `IpregistryVariables`:

```ts
import type { IpregistryVariables } from '@ipregistry/hono'

const app = new Hono<{ Variables: IpregistryVariables }>()
```

## Testing your app

Pass a stub client so your tests never hit the network or consume credits:

```ts
import type { IpregistryClient } from '@ipregistry/client'

const client = {
    lookupIp: async () => ({
        credits: { consumed: 0, remaining: null },
        data: { ip: '66.165.2.7', location: { country: { code: 'US' } } },
        throttling: null,
    }),
} as unknown as IpregistryClient

app.use(ipregistry({ client }))
```

## API reference

| Export                                                  | Description                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ipregistry(options?)`                                  | The enrichment middleware. Sets the `ipregistry` context variable.            |
| `blockCountries(options)`                               | Middleware blocking (or exclusively allowing) countries. Defaults to 451.     |
| `blockThreats(options?)`                                | Middleware blocking threats and, opt-in, anonymized traffic. Defaults to 403. |
| `redirectByCountry(options)`                            | Middleware redirecting visitors to country-specific paths or domains.         |
| `getIpregistry(c)`                                      | Reads the `IpregistryContext` from the context. Never throws.                 |
| `isEuVisitor(input, options?)`                          | Whether the visitor is in the European Union.                                 |
| `isThreat(input, options?)`                             | Whether the visitor's IP is flagged by Ipregistry security data.              |
| `isBot(input)`                                          | Local User-Agent bot heuristic. Never calls the API.                          |
| `createIpregistryClient(options?, env?)`                | Builds the underlying `IpregistryClient` from options and environment.        |
| `createIpExtractor(source?)`                            | Builds an IP extractor from a preset, header, or function.                    |
| `isValidIp`, `isPrivateIp`, `sanitizeIp`, `anonymizeIp` | IP utilities used by the middleware, exported for reuse.                      |

Types: `IpregistryOptions`, `IpregistryConnectionOptions`, `IpregistryContext`, `IpregistryLookupContext`, `IpregistryVariables`, `IpregistrySkipReason`, `IpregistryErrorInfo`, `IpSource`, `IpExtractor`, `TrustedProxyPreset`, `ThreatOptions`, `BlockCountriesOptions`, `BlockThreatsOptions`, `RedirectByCountryOptions`, plus the SDK's `IpInfo`, `Location`, `Security`, `Company`, `Connection`, `Currency`, `Carrier`, `TimeZone`, `UserAgent`.

Everything ships from a single entry point: `import { ... } from '@ipregistry/hono'`.

## Examples

- [`examples/cloudflare-workers`](examples/cloudflare-workers) — Workers app with secrets, threat blocking, and country redirects.
- [`examples/node`](examples/node) — Node.js server with `@hono/node-server` and conninfo-based IP extraction.

## Migrating from `@ipregistry/client`

Already using the SDK directly in your Hono app? See [MIGRATION.md](MIGRATION.md). Batch lookups, ASN lookups, and user-agent parsing stay on `@ipregistry/client`, which this library re-uses and re-exports types from.

## Other resources

- [Ipregistry documentation](https://ipregistry.co/docs)
- [Issue tracker](https://github.com/ipregistry/ipregistry-hono/issues)
- Support: [support@ipregistry.co](mailto:support@ipregistry.co)

## License

[Apache 2.0](LICENSE.txt).
