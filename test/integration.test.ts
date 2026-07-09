import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    blockThreats,
    getIpregistry,
    ipregistry,
    isEuVisitor,
    type IpregistryContext,
} from '../src/index.js'
import { euIpInfo, ipInfo } from './fixtures.js'

const PUBLIC_IP = '66.165.2.7'

/**
 * End-to-end through the real SDK: middleware -> @ipregistry/client ->
 * mocked fetch -> context variable -> handler. Only the network is stubbed.
 */
describe('integration', () => {
    beforeEach(() => {
        vi.stubEnv('IPREGISTRY_API_KEY', '')
        vi.stubEnv('IPREGISTRY_FIELDS', '')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    function stubApi(payload: unknown) {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                        'ipregistry-credits-consumed': '1',
                        'ipregistry-credits-remaining': '99999',
                    },
                }),
        )
        vi.stubGlobal('fetch', fetchMock)
        return fetchMock
    }

    it('enriches a request end to end and caches repeat lookups', async () => {
        const fetchMock = stubApi(ipInfo())

        const app = new Hono()
        app.use(
            ipregistry({
                apiKey: 'test-key',
                fields: 'ip,location,security',
            }),
        )
        app.get('/', (c) => {
            const context = getIpregistry(c)
            return c.json({
                country: context.data?.location?.country?.code,
                eu: isEuVisitor(c),
            })
        })

        const first = await app.request('/', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })
        expect(first.status).toBe(200)
        expect(await first.json()).toEqual({ country: 'US', eu: false })

        const url = String(fetchMock.mock.calls[0]?.[0])
        expect(url).toContain(`/${PUBLIC_IP}`)
        expect(url).toContain('fields=ip%2Clocation%2Csecurity')

        // Same IP again: served from the SDK's in-memory cache.
        const second = await app.request('/', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })
        expect(second.status).toBe(200)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('composes enrichment and threat blocking', async () => {
        stubApi(
            ipInfo({
                security: { is_threat: true },
            } as never),
        )

        const app = new Hono()
        app.use(ipregistry({ apiKey: 'test-key', cache: false }))
        app.use(blockThreats())
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })

        expect(response.status).toBe(403)
    })

    it('serves EU visitors with EU data', async () => {
        stubApi(euIpInfo())

        const app = new Hono()
        app.use(ipregistry({ apiKey: 'test-key', cache: false }))
        app.get('/', (c) =>
            c.json({
                eu: isEuVisitor(c),
                context: c.var.ipregistry,
            }),
        )

        const response = await app.request('/', {
            headers: { 'x-forwarded-for': '2.2.2.2, 10.0.0.1' },
        })

        const body = (await response.json()) as {
            eu: boolean
            context: IpregistryContext
        }
        expect(body.eu).toBe(true)
        expect(body.context.ip).toBe('2.2.2.2')
        expect(body.context.data?.location?.country?.code).toBe('FR')
    })

    it('fails open end to end when the API errors', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            code: 'INVALID_API_KEY',
                            message: 'Invalid API key.',
                            resolution: 'Check your key.',
                        }),
                        { status: 403 },
                    ),
            ),
        )

        const app = new Hono()
        app.use(ipregistry({ apiKey: 'bad-key', cache: false }))
        app.get('/', (c) => c.json(c.var.ipregistry))

        const response = await app.request('/', {
            headers: { 'x-real-ip': PUBLIC_IP },
        })

        expect(response.status).toBe(200)
        const context = (await response.json()) as IpregistryContext
        expect(context.data).toBeNull()
        expect(context.error?.code).toBe('INVALID_API_KEY')
    })
})
