/*
 * Copyright 2026 Ipregistry (https://ipregistry.co).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Context } from 'hono'
import type { ConnInfo } from 'hono/conninfo'

/**
 * Presets naming the proxy headers that can be trusted to carry the real
 * client IP, depending on what sits in front of the Hono server:
 *
 * - `auto`: `cf-connecting-ip`, then `x-real-ip`, then the first
 *   `x-forwarded-for` entry. Safe on managed platforms (Cloudflare Workers,
 *   Deno Deploy, a properly configured reverse proxy) that overwrite these
 *   headers.
 * - `cloudflare`: `cf-connecting-ip` only.
 * - `vercel`: `x-real-ip`, then `x-vercel-forwarded-for`, then
 *   `x-forwarded-for`.
 * - `nginx`: `x-real-ip` (set via `proxy_set_header X-Real-IP $remote_addr`),
 *   then `x-forwarded-for`.
 * - `forwarded-for`: the first `x-forwarded-for` entry only.
 */
export type TrustedProxyPreset =
    'auto' | 'cloudflare' | 'vercel' | 'nginx' | 'forwarded-for'

/**
 * A custom strategy for extracting the client IP from the Hono context.
 * Return a bare IP string, a Hono `ConnInfo`, or null when no trustworthy
 * IP is available. Because `ConnInfo` is accepted, your runtime's
 * `getConnInfo` helper can be passed directly when the server is exposed
 * without a proxy — the same contract as Hono's own `ipRestriction`
 * middleware:
 *
 * ```ts
 * import { getConnInfo } from 'hono/bun' // or hono/deno, hono/cloudflare-workers, @hono/node-server/conninfo
 *
 * ipregistry({ ipSource: getConnInfo })
 * ```
 */
export type IpExtractor = (c: Context) => string | ConnInfo | null | undefined

/**
 * The supported ways to configure IP extraction: a preset name, a single
 * trusted header, or a custom extractor function.
 */
export type IpSource = TrustedProxyPreset | { header: string } | IpExtractor

const PRESET_HEADERS: Record<TrustedProxyPreset, string[]> = {
    auto: ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'],
    cloudflare: ['cf-connecting-ip'],
    vercel: ['x-real-ip', 'x-vercel-forwarded-for', 'x-forwarded-for'],
    nginx: ['x-real-ip', 'x-forwarded-for'],
    'forwarded-for': ['x-forwarded-for'],
}

/**
 * Builds a normalized extractor from an `IpSource`. The returned function
 * only returns syntactically valid IP addresses; forwarded-for style lists
 * are reduced to their first (client) entry, and port suffixes, IPv6
 * brackets, and zone identifiers are stripped.
 */
export function createIpExtractor(
    source: IpSource = 'auto',
): (c: Context) => string | null {
    if (typeof source === 'function') {
        return (c) => {
            const result = source(c)
            const raw =
                typeof result === 'string'
                    ? result
                    : (result?.remote.address ?? null)

            if (!raw) {
                return null
            }

            const candidate = sanitizeIp(raw)
            return isValidIp(candidate) ? candidate : null
        }
    }

    const headerNames =
        typeof source === 'object'
            ? [source.header.toLowerCase()]
            : PRESET_HEADERS[source]

    return (c) => {
        for (const name of headerNames) {
            const value = c.req.header(name)

            if (!value) {
                continue
            }

            const first = value.split(',')[0]
            const candidate = first ? sanitizeIp(first) : null

            if (candidate && isValidIp(candidate)) {
                return candidate
            }
        }

        return null
    }
}

/**
 * Normalizes a raw header value into a bare IP address: trims whitespace,
 * removes IPv6 brackets, port suffixes ('1.2.3.4:8080', '[::1]:8080'), and
 * IPv6 zone identifiers ('fe80::1%eth0').
 */
export function sanitizeIp(raw: string): string {
    let ip = raw.trim()

    const bracketMatch = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
    if (bracketMatch) {
        ip = bracketMatch[1] as string
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) {
        ip = ip.slice(0, ip.lastIndexOf(':'))
    }

    const zoneIndex = ip.indexOf('%')
    if (zoneIndex !== -1) {
        ip = ip.slice(0, zoneIndex)
    }

    return ip
}

export function isValidIp(ip: string): boolean {
    return isValidIpv4(ip) || isValidIpv6(ip)
}

function isValidIpv4(ip: string): boolean {
    const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)

    if (!match) {
        return false
    }

    for (let i = 1; i <= 4; i++) {
        const octet = Number(match[i])
        if (octet > 255) {
            return false
        }
    }

    return true
}

function isValidIpv6(ip: string): boolean {
    if (!ip.includes(':') || ip.includes(':::')) {
        return false
    }

    const halves = ip.split('::')
    if (halves.length > 2) {
        return false
    }

    const splitGroups = (part: string) => (part === '' ? [] : part.split(':'))
    const groups = [
        ...splitGroups(halves[0] as string),
        ...(halves.length === 2 ? splitGroups(halves[1] as string) : []),
    ]

    let groupCount = groups.length
    const last = groups[groups.length - 1]

    if (last !== undefined && last.includes('.')) {
        if (!isValidIpv4(last)) {
            return false
        }
        groups.pop()
        groupCount += 1
    }

    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
            return false
        }
    }

    return halves.length === 2 ? groupCount <= 7 : groupCount === 8
}

/**
 * Whether the address belongs to a private, loopback, link-local, CGNAT, or
 * otherwise non-routable range. The Ipregistry API would reject these with
 * RESERVED_IP_ADDRESS, so the middleware skips the lookup entirely.
 */
export function isPrivateIp(ip: string): boolean {
    if (isValidIpv4(ip)) {
        return isPrivateIpv4(ip)
    }

    const lower = ip.toLowerCase()

    if (lower === '::' || lower === '::1') {
        return true
    }

    // IPv4-mapped addresses (::ffff:192.168.0.1)
    const mappedMatch = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mappedMatch) {
        return isPrivateIpv4(mappedMatch[1] as string)
    }

    // fc00::/7 (unique local) and fe80::/10 (link local)
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)
}

function isPrivateIpv4(ip: string): boolean {
    const octets = ip.split('.').map(Number)
    const [a, b] = octets as [number, number]

    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    )
}

/**
 * Masks an IP address for logging: the last IPv4 octet is zeroed and IPv6
 * addresses are truncated to their first three groups. The library never
 * logs full IP addresses.
 */
export function anonymizeIp(ip: string): string {
    if (isValidIpv4(ip)) {
        return ip.replace(/\.\d{1,3}$/, '.0')
    }

    if (ip.includes(':')) {
        const groups = ip.split(':')
        return `${groups.slice(0, 3).join(':')}::`
    }

    return 'invalid'
}
