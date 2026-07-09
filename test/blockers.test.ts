import type { IpInfo } from '@ipregistry/client'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import {
    blockCountries,
    blockThreats,
    redirectByCountry,
} from '../src/blockers.js'
import type { IpregistryContext } from '../src/types.js'
import { euIpInfo, ipInfo } from './fixtures.js'

function enrichedApp(data: IpInfo | null, skipped = false) {
    const app = new Hono()
    app.use(async (c, next) => {
        const context: IpregistryContext = skipped
            ? { ip: null, data: null, skipped: 'no-ip' }
            : { ip: data?.ip ?? null, data }
        c.set('ipregistry', context)
        await next()
    })
    return app
}

describe('blockCountries', () => {
    it('blocks listed countries with 451', async () => {
        const app = enrichedApp(ipInfo())
        app.use(blockCountries({ countries: ['us', 'KP'] }))
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(451)
        expect(await response.text()).toContain('restricted')
    })

    it('lets unlisted countries through in block mode', async () => {
        const app = enrichedApp(euIpInfo())
        app.use(blockCountries({ countries: ['US'] }))
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(200)
    })

    it('denies everything but the listed countries in allow mode', async () => {
        const app = enrichedApp(ipInfo())
        app.use(blockCountries({ countries: ['FR'], mode: 'allow' }))
        app.get('/', (c) => c.text('ok'))

        expect((await app.request('/')).status).toBe(451)

        const euApp = enrichedApp(euIpInfo())
        euApp.use(blockCountries({ countries: ['FR'], mode: 'allow' }))
        euApp.get('/', (c) => c.text('ok'))

        expect((await euApp.request('/')).status).toBe(200)
    })

    it('fails open when the country is unknown, unless told otherwise', async () => {
        const noLocation = ipInfo({ location: undefined })

        const open = enrichedApp(noLocation)
        open.use(blockCountries({ countries: ['US'] }))
        open.get('/', (c) => c.text('ok'))
        expect((await open.request('/')).status).toBe(200)

        const closed = enrichedApp(noLocation)
        closed.use(blockCountries({ countries: ['US'], unknown: 'block' }))
        closed.get('/', (c) => c.text('ok'))
        expect((await closed.request('/')).status).toBe(451)
    })

    it('passes through skipped lookups', async () => {
        const app = enrichedApp(null, true)
        app.use(blockCountries({ countries: ['US'], unknown: 'block' }))
        app.get('/', (c) => c.text('ok'))

        // The unknown policy applies: a skipped lookup has no country either.
        expect((await app.request('/')).status).toBe(451)

        const open = enrichedApp(null, true)
        open.use(blockCountries({ countries: ['US'] }))
        open.get('/', (c) => c.text('ok'))
        expect((await open.request('/')).status).toBe(200)
    })

    it('supports a custom status and response factory', async () => {
        const app = enrichedApp(ipInfo())
        app.use(blockCountries({ countries: ['US'], status: 403 }))
        app.get('/', (c) => c.text('ok'))
        expect((await app.request('/')).status).toBe(403)

        const custom = enrichedApp(ipInfo())
        custom.use(
            blockCountries({
                countries: ['US'],
                response: (c) => c.json({ blocked: true }, 451),
            }),
        )
        custom.get('/', (c) => c.text('ok'))

        const response = await custom.request('/')
        expect(response.status).toBe(451)
        expect(await response.json()).toEqual({ blocked: true })
    })

    it('throws an HTTPException observable through app.onError', async () => {
        const { HTTPException } = await import('hono/http-exception')
        const seen: unknown[] = []

        const app = enrichedApp(ipInfo())
        app.onError((error, c) => {
            seen.push(error)
            return c.json({ branded: true }, 451)
        })
        app.use(blockCountries({ countries: ['US'] }))
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(451)
        expect(await response.json()).toEqual({ branded: true })
        expect(seen[0]).toBeInstanceOf(HTTPException)
    })

    it('throws when the ipregistry middleware did not run', async () => {
        const app = new Hono()
        app.use(blockCountries({ countries: ['US'] }))
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(500)
    })
})

describe('blockThreats', () => {
    it('blocks flagged threats with 403 by default', async () => {
        const app = enrichedApp(
            ipInfo({ security: { is_threat: true } } as never),
        )
        app.use(blockThreats())
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(403)
        expect(await response.text()).toContain('denied')
    })

    it('lets clean visitors through', async () => {
        const app = enrichedApp(ipInfo())
        app.use(blockThreats())
        app.get('/', (c) => c.text('ok'))

        expect((await app.request('/')).status).toBe(200)
    })

    it('blocks anonymization signals only when opted in', async () => {
        const torInfo = ipInfo({ security: { is_tor: true } } as never)

        const lenient = enrichedApp(torInfo)
        lenient.use(blockThreats())
        lenient.get('/', (c) => c.text('ok'))
        expect((await lenient.request('/')).status).toBe(200)

        const strict = enrichedApp(torInfo)
        strict.use(blockThreats({ tor: true }))
        strict.get('/', (c) => c.text('ok'))
        expect((await strict.request('/')).status).toBe(403)
    })

    it('passes through skipped or failed lookups (fail-open)', async () => {
        const app = enrichedApp(null, true)
        app.use(blockThreats())
        app.get('/', (c) => c.text('ok'))

        expect((await app.request('/')).status).toBe(200)
    })

    it('supports a custom response factory', async () => {
        const app = enrichedApp(
            ipInfo({ security: { is_attacker: true } } as never),
        )
        app.use(
            blockThreats({
                response: (c) => c.json({ reason: 'threat' }, 418),
            }),
        )
        app.get('/', (c) => c.text('ok'))

        const response = await app.request('/')
        expect(response.status).toBe(418)
        expect(await response.json()).toEqual({ reason: 'threat' })
    })
})

describe('redirectByCountry', () => {
    it('redirects mapped countries with 307 by default', async () => {
        const app = enrichedApp(euIpInfo())
        app.use(redirectByCountry({ redirects: { fr: '/fr' } }))
        app.get('/*', (c) => c.text('ok'))

        const response = await app.request('https://example.com/pricing')
        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toBe('https://example.com/fr')
    })

    it('appends the current path when preservePath is set', async () => {
        const app = enrichedApp(euIpInfo())
        app.use(
            redirectByCountry({
                redirects: { FR: '/fr' },
                preservePath: true,
                status: 308,
            }),
        )
        app.get('/*', (c) => c.text('ok'))

        const response = await app.request(
            'https://example.com/pricing?plan=pro',
        )
        expect(response.status).toBe(308)
        expect(response.headers.get('location')).toBe(
            'https://example.com/fr/pricing?plan=pro',
        )
    })

    it('never redirects visitors already under the destination', async () => {
        const app = enrichedApp(euIpInfo())
        app.use(redirectByCountry({ redirects: { FR: '/fr' } }))
        app.get('/*', (c) => c.text('ok'))

        expect(
            (await app.request('https://example.com/fr/pricing')).status,
        ).toBe(200)
        expect((await app.request('https://example.com/fr')).status).toBe(200)
    })

    it('redirects to absolute URLs on other hosts', async () => {
        const app = enrichedApp(euIpInfo())
        app.use(redirectByCountry({ redirects: { FR: 'https://example.fr' } }))
        app.get('/*', (c) => c.text('ok'))

        const response = await app.request('https://example.com/pricing')
        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toBe('https://example.fr/')
    })

    it('ignores unmapped countries and missing data', async () => {
        const app = enrichedApp(ipInfo())
        app.use(redirectByCountry({ redirects: { FR: '/fr' } }))
        app.get('/*', (c) => c.text('ok'))
        expect((await app.request('https://example.com/')).status).toBe(200)

        const skipped = enrichedApp(null, true)
        skipped.use(redirectByCountry({ redirects: { FR: '/fr' } }))
        skipped.get('/*', (c) => c.text('ok'))
        expect((await skipped.request('https://example.com/')).status).toBe(200)
    })
})
