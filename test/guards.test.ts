import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { isBot, isEuVisitor, isThreat } from '../src/guards.js'
import type { IpregistryContext } from '../src/types.js'
import { euIpInfo, ipInfo } from './fixtures.js'

function contextOf(data: ReturnType<typeof ipInfo> | null): IpregistryContext {
    return { ip: data?.ip ?? null, data }
}

describe('isEuVisitor', () => {
    it('detects EU visitors from IpInfo and IpregistryContext', () => {
        expect(isEuVisitor(euIpInfo())).toBe(true)
        expect(isEuVisitor(ipInfo())).toBe(false)
        expect(isEuVisitor(contextOf(euIpInfo()))).toBe(true)
        expect(isEuVisitor(contextOf(ipInfo()))).toBe(false)
    })

    it('fails open on missing data unless assumeEu is set', () => {
        expect(isEuVisitor(null)).toBe(false)
        expect(isEuVisitor(undefined)).toBe(false)
        expect(isEuVisitor(contextOf(null))).toBe(false)
        expect(isEuVisitor(null, { assumeEu: true })).toBe(true)
        expect(isEuVisitor(contextOf(null), { assumeEu: true })).toBe(true)
    })

    it('accepts a Hono context enriched by the middleware', async () => {
        const app = new Hono()
        app.use(async (c, next) => {
            c.set('ipregistry', contextOf(euIpInfo()))
            await next()
        })
        app.get('/', (c) => c.json({ eu: isEuVisitor(c) }))

        const response = await app.request('/')
        expect(await response.json()).toEqual({ eu: true })
    })

    it('fails open on a Hono context without Ipregistry data', async () => {
        const app = new Hono()
        app.get('/', (c) => c.json({ eu: isEuVisitor(c) }))

        const response = await app.request('/')
        expect(await response.json()).toEqual({ eu: false })
    })
})

describe('isThreat', () => {
    it('checks threat, attacker, and abuser by default', () => {
        expect(isThreat(ipInfo())).toBe(false)
        expect(
            isThreat(ipInfo({ security: { is_threat: true } } as never)),
        ).toBe(true)
        expect(
            isThreat(ipInfo({ security: { is_attacker: true } } as never)),
        ).toBe(true)
        expect(
            isThreat(ipInfo({ security: { is_abuser: true } } as never)),
        ).toBe(true)
    })

    it('treats anonymization signals as opt-in', () => {
        const torInfo = ipInfo({ security: { is_tor: true } } as never)
        const vpnInfo = ipInfo({ security: { is_vpn: true } } as never)

        expect(isThreat(torInfo)).toBe(false)
        expect(isThreat(torInfo, { tor: true })).toBe(true)
        expect(isThreat(vpnInfo)).toBe(false)
        expect(isThreat(vpnInfo, { vpn: true })).toBe(true)
    })

    it('covers tor exits under the tor flag', () => {
        const exitInfo = ipInfo({ security: { is_tor_exit: true } } as never)
        expect(isThreat(exitInfo, { tor: true })).toBe(true)
    })

    it('allows disabling default signals', () => {
        const info = ipInfo({ security: { is_threat: true } } as never)
        expect(isThreat(info, { threat: false })).toBe(false)
    })

    it('fails open on missing data', () => {
        expect(isThreat(null)).toBe(false)
        expect(isThreat(contextOf(null))).toBe(false)
        expect(isThreat(ipInfo({ security: undefined }))).toBe(false)
    })
})

describe('isBot', () => {
    it('detects bots from user agent strings', () => {
        expect(
            isBot(
                'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            ),
        ).toBe(true)
        expect(
            isBot(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ),
        ).toBe(false)
    })

    it('reads the user agent from Request-like inputs', () => {
        const request = new Request('https://example.com', {
            headers: { 'user-agent': 'curl/8.5.0' },
        })
        expect(typeof isBot(request)).toBe('boolean')
        expect(isBot({ headers: { 'user-agent': undefined } })).toBe(false)
    })

    it('reads the user agent from a Hono context', async () => {
        const app = new Hono()
        app.get('/', (c) => c.json({ bot: isBot(c) }))

        const bot = await app.request('/', {
            headers: {
                'user-agent':
                    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
            },
        })
        expect(await bot.json()).toEqual({ bot: true })

        const human = await app.request('/', {
            headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
        })
        expect(await human.json()).toEqual({ bot: false })
    })

    it('fails open without a user agent', () => {
        expect(isBot(null)).toBe(false)
        expect(isBot(undefined)).toBe(false)
        expect(isBot({ headers: {} })).toBe(false)
    })
})
