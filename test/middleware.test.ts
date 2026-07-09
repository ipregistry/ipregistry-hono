import type { IpregistryClient } from '@ipregistry/client'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipregistry, type IpregistryOptions } from '../src/middleware.js'
import type { IpregistryContext } from '../src/types.js'
import { ipInfo } from './fixtures.js'

const PUBLIC_IP = '66.165.2.7'

function stubClient(
    lookupIp: (...args: unknown[]) => unknown,
): IpregistryClient {
    return { lookupIp } as unknown as IpregistryClient
}

function okClient(data = ipInfo()) {
    return stubClient(async () => ({
        credits: { consumed: 1, remaining: 1000 },
        data,
        throttling: null,
    }))
}

function appWith(options: IpregistryOptions = {}) {
    const app = new Hono()
    app.use(ipregistry(options))
    app.get('/*', (c) => c.json(c.var.ipregistry))
    return app
}

async function contextFor(
    options: IpregistryOptions,
    path = '/pricing',
    headers: Record<string, string> = { 'x-real-ip': PUBLIC_IP },
): Promise<IpregistryContext> {
    const response = await appWith(options).request(path, { headers })
    expect(response.status).toBe(200)
    return (await response.json()) as IpregistryContext
}

describe('ipregistry middleware', () => {
    beforeEach(() => {
        vi.stubEnv('IPREGISTRY_API_KEY', '')
        vi.stubEnv('IPREGISTRY_FIELDS', '')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('attaches lookup data to the context', async () => {
        const context = await contextFor({ client: okClient() })

        expect(context.ip).toBe(PUBLIC_IP)
        expect(context.data?.location?.country?.code).toBe('US')
        expect(context.skipped).toBeUndefined()
        expect(context.error).toBeUndefined()
    })

    it('passes fields and hostname options through to the SDK', async () => {
        const lookupIp = vi.fn(async () => ({
            credits: { consumed: 1, remaining: null },
            data: ipInfo(),
            throttling: null,
        }))

        await contextFor({
            client: stubClient(lookupIp),
            fields: 'location,security',
            hostname: true,
        })

        expect(lookupIp).toHaveBeenCalledWith(PUBLIC_IP, {
            fields: 'location,security',
            hostname: true,
        })
    })

    it('reads the field selection from IPREGISTRY_FIELDS', async () => {
        vi.stubEnv('IPREGISTRY_FIELDS', 'ip,location')
        const lookupIp = vi.fn(async () => ({
            credits: { consumed: 1, remaining: null },
            data: ipInfo(),
            throttling: null,
        }))

        await contextFor({ client: stubClient(lookupIp) })

        expect(lookupIp).toHaveBeenCalledWith(PUBLIC_IP, {
            fields: 'ip,location',
        })
    })

    it('skips static assets by default and never calls the API', async () => {
        const lookupIp = vi.fn()
        const context = await contextFor(
            { client: stubClient(lookupIp) },
            '/logo.png',
        )

        expect(context.skipped).toBe('static-asset')
        expect(context.data).toBeNull()
        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('enriches static assets when skipStaticAssets is false', async () => {
        const context = await contextFor(
            { client: okClient(), skipStaticAssets: false },
            '/logo.png',
        )

        expect(context.skipped).toBeUndefined()
        expect(context.data?.ip).toBe(PUBLIC_IP)
    })

    it('skips bots when skipBots is enabled', async () => {
        const lookupIp = vi.fn()
        const context = await contextFor(
            { client: stubClient(lookupIp), skipBots: true },
            '/pricing',
            {
                'x-real-ip': PUBLIC_IP,
                'user-agent':
                    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            },
        )

        expect(context.skipped).toBe('bot')
        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('matches bots against a custom regular expression', async () => {
        const context = await contextFor(
            { client: okClient(), skipBots: /internal-probe/ },
            '/pricing',
            { 'x-real-ip': PUBLIC_IP, 'user-agent': 'internal-probe/1.0' },
        )

        expect(context.skipped).toBe('bot')
    })

    it('honors a custom skip predicate', async () => {
        const context = await contextFor({
            client: okClient(),
            skip: (c) => c.req.path === '/pricing',
        })

        expect(context.skipped).toBe('custom')
    })

    it('skips lookups when no public IP can be extracted', async () => {
        const lookupIp = vi.fn()

        const cases: Record<string, string>[] = [
            {},
            { 'x-real-ip': '192.168.1.10' },
            { 'x-real-ip': 'not-an-ip' },
        ]

        for (const headers of cases) {
            const context = await contextFor(
                { client: stubClient(lookupIp) },
                '/pricing',
                headers,
            )
            expect(context.skipped).toBe('no-ip')
            expect(context.ip).toBeNull()
        }

        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('substitutes developmentIp for missing or private IPs', async () => {
        const context = await contextFor(
            { client: okClient(), developmentIp: PUBLIC_IP },
            '/pricing',
            { 'x-real-ip': '127.0.0.1' },
        )

        expect(context.ip).toBe(PUBLIC_IP)
        expect(context.data?.ip).toBe(PUBLIC_IP)
    })

    it('rejects an invalid developmentIp at registration time', () => {
        expect(() => ipregistry({ developmentIp: 'localhost' })).toThrow(
            TypeError,
        )
    })

    it('fails open on lookup errors and reports them', async () => {
        const failure = new Error('boom')
        const onError = vi.fn()
        const context = await contextFor({
            client: stubClient(async () => {
                throw failure
            }),
            onError,
        })

        expect(context.ip).toBe(PUBLIC_IP)
        expect(context.data).toBeNull()
        expect(context.error).toEqual({
            code: 'CLIENT_ERROR',
            message: 'boom',
        })
        expect(onError).toHaveBeenCalledWith(failure, expect.anything())
    })

    it('fails open when the API key is missing', async () => {
        const context = await contextFor({})

        expect(context.data).toBeNull()
        expect(context.error?.code).toBe('MISSING_API_KEY')
    })

    it('responds 503 when failClosed is set and the lookup fails', async () => {
        const app = appWith({
            client: stubClient(async () => {
                throw new Error('boom')
            }),
            failClosed: true,
        })

        const response = await app.request('/pricing', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })

        expect(response.status).toBe(503)
    })

    it('honors a numeric failClosed status', async () => {
        const app = appWith({
            client: stubClient(async () => {
                throw new Error('boom')
            }),
            failClosed: 429,
        })

        const response = await app.request('/pricing', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })

        expect(response.status).toBe(429)
    })

    it('does not fail closed on skipped lookups', async () => {
        const app = appWith({
            client: stubClient(async () => {
                throw new Error('boom')
            }),
            failClosed: true,
        })

        const response = await app.request('/pricing')

        expect(response.status).toBe(200)
        const context = (await response.json()) as IpregistryContext
        expect(context.skipped).toBe('no-ip')
    })

    it('looks up at most once when registered twice', async () => {
        const lookupIp = vi.fn(async () => ({
            credits: { consumed: 1, remaining: null },
            data: ipInfo(),
            throttling: null,
        }))

        const app = new Hono()
        app.use(ipregistry({ client: stubClient(lookupIp) }))
        app.use(ipregistry({ client: stubClient(lookupIp) }))
        app.get('/', (c) => c.json(c.var.ipregistry))

        const response = await app.request('/', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })

        expect(response.status).toBe(200)
        expect(lookupIp).toHaveBeenCalledTimes(1)
    })

    it('reads the API key from Cloudflare-style bindings', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify(ipInfo()), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        )
        vi.stubGlobal('fetch', fetchMock)

        try {
            // No client and no apiKey option: the middleware must build the
            // client from the environment passed as Workers-style bindings.
            const app = appWith({})

            const response = await app.request(
                '/pricing',
                { headers: { 'x-real-ip': PUBLIC_IP } },
                { IPREGISTRY_API_KEY: 'binding-key' },
            )

            expect(response.status).toBe(200)
            const context = (await response.json()) as IpregistryContext
            expect(context.error).toBeUndefined()
            expect(context.data?.ip).toBe(PUBLIC_IP)

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
            expect(String(url)).toContain(PUBLIC_IP)
            expect(new Headers(init.headers).get('authorization')).toBe(
                'ApiKey binding-key',
            )
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('uses the IP selected by a custom ipSource', async () => {
        const lookupIp = vi.fn(async () => ({
            credits: { consumed: 1, remaining: null },
            data: ipInfo(),
            throttling: null,
        }))

        await contextFor(
            {
                client: stubClient(lookupIp),
                ipSource: { header: 'x-client-ip' },
            },
            '/pricing',
            { 'x-client-ip': '8.8.4.4', 'x-real-ip': PUBLIC_IP },
        )

        expect(lookupIp).toHaveBeenCalledWith('8.8.4.4', {})
    })
})
