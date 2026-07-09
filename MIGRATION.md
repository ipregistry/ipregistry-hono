# Migrating from `@ipregistry/client` to `@ipregistry/hono`

`@ipregistry/hono` is a layer on top of the official [`@ipregistry/client`](https://github.com/ipregistry/ipregistry-javascript) SDK, not a replacement. It removes the request-path boilerplate you would otherwise write in every Hono app: extracting the client IP from the right proxy header, validating it, refusing to send private addresses to the API, caching, failing open, and sharing the result across middleware and handlers.

## Before

```ts
import { Hono } from 'hono'
import { IpregistryClient } from '@ipregistry/client'

const app = new Hono()
const client = new IpregistryClient({ apiKey: process.env.IPREGISTRY_API_KEY! })

app.get('/', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()

    if (!ip) {
        return c.text('Hello visitor!')
    }

    try {
        const response = await client.lookupIp(ip, { fields: 'location' })
        const country = response.data.location?.country?.name
        return c.text(`Hello ${country ?? 'visitor'}!`)
    } catch {
        return c.text('Hello visitor!')
    }
})
```

This version trusts a spoofable header as-is, sends `127.0.0.1` to the API on localhost (and burns a credit on the error), performs one lookup per handler instead of per request, and repeats the try/catch everywhere.

## After

```ts
import { Hono } from 'hono'
import { ipregistry } from '@ipregistry/hono'

const app = new Hono()

app.use(ipregistry({ fields: 'ip,location' }))

app.get('/', (c) => {
    const country = c.var.ipregistry.data?.location?.country?.name
    return c.text(`Hello ${country ?? 'visitor'}!`)
})
```

The API key is read from `IPREGISTRY_API_KEY` (environment variable or Workers binding).

## Mapping

| SDK pattern                                            | Library pattern                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `new IpregistryClient({ apiKey })`                     | `ipregistry()` + `IPREGISTRY_API_KEY`                                                      |
| `client.lookupIp(ip, { fields })` per handler          | One `ipregistry({ fields })` middleware, `c.var.ipregistry` everywhere                     |
| Hand-rolled `x-forwarded-for` parsing                  | `ipSource` presets, `{ header }`, or a custom extractor                                    |
| Hand-rolled private-IP filtering                       | Built-in: private/reserved IPs never reach the API                                         |
| `try { ... } catch { /* ignore */ }` per call          | Fail-open by default, `error` info on the context, `onError` hook                          |
| `new IpregistryClient({ cache: new InMemoryCache() })` | Default behavior; override with the `cache` option                                         |
| Country/threat checks per handler                      | `blockCountries()`, `blockThreats()`, `redirectByCountry()`, `isEuVisitor()`, `isThreat()` |

## What stays on `@ipregistry/client`

Use the SDK directly for anything outside the request path:

- Batch lookups: `client.batchLookupIps([...])`
- ASN lookups: `client.lookupAsn(...)`, `client.batchLookupAsns([...])`
- Origin lookups (your server's own IP): `client.originLookupIp()`
- User-agent parsing: `client.parseUserAgents([...])`
- Background jobs, scripts, and anything that is not a Hono request

You can build a ready-configured client from the same options and environment with `createIpregistryClient(options, env(c))`, or reuse the exact instance the middleware uses by passing your own via the `client` option.
