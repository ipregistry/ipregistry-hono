# Node.js example

Copy-ready file showing `@ipregistry/hono` on Node.js with `@hono/node-server`, including conninfo-based IP extraction for servers that are directly exposed (no reverse proxy).

## Files

- `src/index.ts` — the server: `ipregistry()` middleware, country blocking, and a JSON endpoint.

## Run it

```sh
mkdir my-app && cd my-app
npm init -y && npm pkg set type=module
npm install hono @hono/node-server @ipregistry/hono
npm install -D tsx typescript
# copy src/index.ts, then:
IPREGISTRY_API_KEY=your_key npx tsx src/index.ts
```

Requests from localhost have no public IP, so lookups are skipped with the `no-ip` reason. Set the `developmentIp` option to a fixed public IP to exercise geo features during development.

Behind Nginx (or any reverse proxy), drop the custom `ipSource` and use the `nginx` preset instead — and make sure the proxy overwrites `X-Real-IP`.
