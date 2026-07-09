import { Hono, type Context } from 'hono'
import { describe, expect, it } from 'vitest'

import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    sanitizeIp,
    type IpSource,
} from '../src/ip.js'

async function extractFrom(
    headers: Record<string, string>,
    source?: IpSource,
): Promise<string | null> {
    const extract = createIpExtractor(source)
    let result: string | null = null

    const app = new Hono()
    app.get('/', (c) => {
        result = extract(c)
        return c.body(null, 204)
    })

    await app.request('/', { headers })
    return result
}

describe('createIpExtractor', () => {
    it('prefers cf-connecting-ip with the auto preset', async () => {
        expect(
            await extractFrom({
                'cf-connecting-ip': '66.165.2.7',
                'x-real-ip': '8.8.8.8',
                'x-forwarded-for': '9.9.9.9',
            }),
        ).toBe('66.165.2.7')
    })

    it('falls back to x-real-ip then x-forwarded-for', async () => {
        expect(await extractFrom({ 'x-real-ip': '8.8.8.8' })).toBe('8.8.8.8')
        expect(
            await extractFrom({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }),
        ).toBe('9.9.9.9')
    })

    it('takes the first entry of a forwarded-for list', async () => {
        expect(
            await extractFrom(
                { 'x-forwarded-for': '66.165.2.7, 172.16.0.1, 10.0.0.1' },
                'forwarded-for',
            ),
        ).toBe('66.165.2.7')
    })

    it('honors the cloudflare preset exclusively', async () => {
        expect(
            await extractFrom({ 'x-real-ip': '8.8.8.8' }, 'cloudflare'),
        ).toBeNull()
        expect(
            await extractFrom(
                { 'cf-connecting-ip': '66.165.2.7' },
                'cloudflare',
            ),
        ).toBe('66.165.2.7')
    })

    it('supports a single custom trusted header', async () => {
        expect(
            await extractFrom(
                { 'x-client-ip': '66.165.2.7' },
                {
                    header: 'X-Client-IP',
                },
            ),
        ).toBe('66.165.2.7')
    })

    it('supports a custom extractor and validates its result', async () => {
        expect(await extractFrom({}, () => '66.165.2.7')).toBe('66.165.2.7')
        expect(await extractFrom({}, () => 'not-an-ip')).toBeNull()
        expect(await extractFrom({}, () => null)).toBeNull()
    })

    it('rejects malformed header values', async () => {
        expect(await extractFrom({ 'x-real-ip': 'oh hi' })).toBeNull()
        expect(await extractFrom({ 'x-real-ip': '999.1.1.1' })).toBeNull()
        expect(await extractFrom({})).toBeNull()
    })

    it('strips ports, brackets, and zone identifiers', async () => {
        expect(await extractFrom({ 'x-real-ip': '66.165.2.7:8080' })).toBe(
            '66.165.2.7',
        )
        expect(await extractFrom({ 'x-real-ip': '[2001:db8::1]:443' })).toBe(
            '2001:db8::1',
        )
    })

    it('accepts getConnInfo-style extractors returning ConnInfo', async () => {
        expect(
            await extractFrom({}, () => ({
                remote: { address: '66.165.2.7', addressType: 'IPv4' },
            })),
        ).toBe('66.165.2.7')
        expect(await extractFrom({}, () => ({ remote: {} }))).toBeNull()
        expect(
            await extractFrom({}, () => ({
                remote: { address: 'fe80::1%eth0' },
            })),
        ).toBe('fe80::1')
    })

    it('passes the Hono context to custom extractors', async () => {
        const seen: string[] = []
        await extractFrom({ 'x-thing': 'yes' }, (c: Context) => {
            seen.push(c.req.path)
            return null
        })
        expect(seen).toEqual(['/'])
    })
})

describe('sanitizeIp', () => {
    it('normalizes common header forms', () => {
        expect(sanitizeIp(' 66.165.2.7 ')).toBe('66.165.2.7')
        expect(sanitizeIp('66.165.2.7:3128')).toBe('66.165.2.7')
        expect(sanitizeIp('[2001:db8::1]')).toBe('2001:db8::1')
        expect(sanitizeIp('[2001:db8::1]:8443')).toBe('2001:db8::1')
        expect(sanitizeIp('fe80::1%eth0')).toBe('fe80::1')
    })
})

describe('isValidIp', () => {
    it('accepts valid IPv4 and IPv6 addresses', () => {
        expect(isValidIp('66.165.2.7')).toBe(true)
        expect(isValidIp('255.255.255.255')).toBe(true)
        expect(isValidIp('2001:db8::1')).toBe(true)
        expect(isValidIp('::1')).toBe(true)
        expect(isValidIp('::ffff:192.168.0.1')).toBe(true)
        expect(isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
    })

    it('rejects invalid addresses', () => {
        expect(isValidIp('')).toBe(false)
        expect(isValidIp('256.1.1.1')).toBe(false)
        expect(isValidIp('1.2.3')).toBe(false)
        expect(isValidIp('example.com')).toBe(false)
        expect(isValidIp('2001:db8:::1')).toBe(false)
        expect(isValidIp('1:2:3:4:5:6:7:8:9')).toBe(false)
    })
})

describe('isPrivateIp', () => {
    it('flags private, loopback, CGNAT, and link-local ranges', () => {
        expect(isPrivateIp('10.1.2.3')).toBe(true)
        expect(isPrivateIp('127.0.0.1')).toBe(true)
        expect(isPrivateIp('100.64.0.1')).toBe(true)
        expect(isPrivateIp('169.254.10.10')).toBe(true)
        expect(isPrivateIp('172.16.0.1')).toBe(true)
        expect(isPrivateIp('172.31.255.255')).toBe(true)
        expect(isPrivateIp('192.168.1.1')).toBe(true)
        expect(isPrivateIp('::1')).toBe(true)
        expect(isPrivateIp('fc00::1')).toBe(true)
        expect(isPrivateIp('fe80::1')).toBe(true)
        expect(isPrivateIp('::ffff:192.168.0.1')).toBe(true)
    })

    it('lets public addresses through', () => {
        expect(isPrivateIp('66.165.2.7')).toBe(false)
        expect(isPrivateIp('8.8.8.8')).toBe(false)
        expect(isPrivateIp('172.32.0.1')).toBe(false)
        expect(isPrivateIp('100.128.0.1')).toBe(false)
        expect(isPrivateIp('2001:db8::1')).toBe(false)
    })
})

describe('anonymizeIp', () => {
    it('masks addresses for logging', () => {
        expect(anonymizeIp('66.165.2.7')).toBe('66.165.2.0')
        expect(anonymizeIp('2001:db8:85a3::8a2e:370:7334')).toBe(
            '2001:db8:85a3::',
        )
        expect(anonymizeIp('garbage')).toBe('invalid')
    })
})
