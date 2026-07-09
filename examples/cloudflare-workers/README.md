# Cloudflare Workers example

Copy-ready files showing `@ipregistry/hono` on Cloudflare Workers: request enrichment, threat blocking, country redirects, and a small JSON endpoint.

## Files

- `src/index.ts` — the Worker: `ipregistry()` middleware plus blockers and routes.
- `wrangler.toml` — minimal Worker configuration.

## Run it

```sh
npm create hono@latest my-app -- --template cloudflare-workers
cd my-app
npm install @ipregistry/hono
# copy src/index.ts and merge wrangler.toml, then:
npx wrangler secret put IPREGISTRY_API_KEY
npm run deploy
```

For local development, put the key in a `.dev.vars` file (`IPREGISTRY_API_KEY=...`) and run `npm run dev`. Requests from localhost have no public IP, so set the `developmentIp` option to a fixed public IP if you want real lookups during development.

Behind Cloudflare the client IP comes from the `cf-connecting-ip` header, which the default `auto` preset already prefers; pin `ipSource: 'cloudflare'` to trust it exclusively.
