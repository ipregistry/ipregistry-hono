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

import { UserAgents, type IpInfo, type UserAgent } from '@ipregistry/client'
import type { Context } from 'hono'

import type { IpregistryContext } from './types.js'

/**
 * The inputs accepted by the boolean helpers: a Hono context (enriched by
 * the `ipregistry()` middleware), raw SDK `IpInfo` data, the
 * `IpregistryContext` returned by `getIpregistry`, or nothing. All helpers
 * answer false for null/undefined/missing data so they can be used directly
 * on unchecked values.
 */
export type IpInfoInput =
    Context | IpInfo | IpregistryContext | null | undefined

/**
 * Selects which Ipregistry security signals count as a threat. Each flag
 * maps to the same-named `security.is_*` field of the API response. By
 * default `threat`, `attacker`, and `abuser` are checked; anonymization
 * signals (proxy, Tor, VPN, relay) are opt-in because they also match
 * legitimate privacy-conscious users.
 */
export interface ThreatOptions {
    /** Check `security.is_threat`. Default: true. */
    threat?: boolean
    /** Check `security.is_attacker`. Default: true. */
    attacker?: boolean
    /** Check `security.is_abuser`. Default: true. */
    abuser?: boolean
    /** Check `security.is_proxy`. Default: false. */
    proxy?: boolean
    /** Check `security.is_tor` and `security.is_tor_exit`. Default: false. */
    tor?: boolean
    /** Check `security.is_vpn`. Default: false. */
    vpn?: boolean
    /** Check `security.is_relay` (e.g. iCloud Private Relay). Default: false. */
    relay?: boolean
    /** Check `security.is_anonymous`. Default: false. */
    anonymous?: boolean
    /** Check `security.is_cloud_provider`. Default: false. */
    cloudProvider?: boolean
    /** Check `security.is_bogon`. Default: false. */
    bogon?: boolean
}

function isHonoContext(input: object): input is Context {
    return (
        'get' in input &&
        typeof (input as { get: unknown }).get === 'function' &&
        'req' in input
    )
}

function resolveIpInfo(input: IpInfoInput): IpInfo | null {
    if (!input) {
        return null
    }

    if (isHonoContext(input)) {
        const context = input.get('ipregistry') as IpregistryContext | undefined
        return context?.data ?? null
    }

    if ('data' in input && !('ip' in input && 'type' in input)) {
        return (input as IpregistryContext).data
    }

    return input as IpInfo
}

/**
 * Whether the visitor is located in the European Union, based on
 * `location.in_eu`. Useful to decide when to show GDPR consent flows.
 * Returns false when the data is missing (fail-open: treat as non-EU) — pass
 * `{ assumeEu: true }` to flip that default for a conservative GDPR stance.
 */
export function isEuVisitor(
    input: IpInfoInput,
    options?: { assumeEu?: boolean },
): boolean {
    const info = resolveIpInfo(input)
    const inEu = info?.location?.in_eu

    if (typeof inEu !== 'boolean') {
        return options?.assumeEu === true
    }

    return inEu
}

/**
 * Whether Ipregistry flags the visitor's IP as a threat. By default checks
 * `security.is_threat`, `security.is_attacker`, and `security.is_abuser`;
 * see `ThreatOptions` to include proxy/Tor/VPN/relay signals. Returns false
 * when the data is missing.
 */
export function isThreat(input: IpInfoInput, options?: ThreatOptions): boolean {
    const security = resolveIpInfo(input)?.security

    if (!security) {
        return false
    }

    return (
        ((options?.threat ?? true) && security.is_threat === true) ||
        ((options?.attacker ?? true) && security.is_attacker === true) ||
        ((options?.abuser ?? true) && security.is_abuser === true) ||
        (options?.proxy === true && security.is_proxy === true) ||
        (options?.tor === true &&
            (security.is_tor === true || security.is_tor_exit === true)) ||
        (options?.vpn === true && security.is_vpn === true) ||
        (options?.relay === true && security.is_relay === true) ||
        (options?.anonymous === true && security.is_anonymous === true) ||
        (options?.cloudProvider === true &&
            security.is_cloud_provider === true) ||
        (options?.bogon === true && security.is_bogon === true)
    )
}

/**
 * Whether the request comes from a bot or crawler, using the SDK's
 * `UserAgents.isBot` heuristic. Accepts a Hono context, a user agent string,
 * anything with request headers (`Request`, `IncomingMessage`), or a parsed
 * Ipregistry `UserAgent`. Returns false when no user agent is available.
 * Purely local: never calls the API.
 */
export function isBot(
    input:
        | Context
        | string
        | UserAgent
        | { headers: Headers | Record<string, string | string[] | undefined> }
        | null
        | undefined,
): boolean {
    const userAgent = resolveUserAgentString(input)
    return userAgent ? UserAgents.isBot(userAgent) : false
}

function resolveUserAgentString(
    input:
        | Context
        | string
        | UserAgent
        | { headers: Headers | Record<string, string | string[] | undefined> }
        | null
        | undefined,
): string | null {
    if (!input) {
        return null
    }

    if (typeof input === 'string') {
        return input
    }

    if (isHonoContext(input)) {
        return input.req.header('user-agent') ?? null
    }

    if ('headers' in input) {
        const headers = input.headers

        if (typeof (headers as Headers).get === 'function') {
            return (headers as Headers).get('user-agent')
        }

        const value = (
            headers as Record<string, string | string[] | undefined>
        )['user-agent']

        if (Array.isArray(value)) {
            return value[0] ?? null
        }

        return typeof value === 'string' ? value : null
    }

    if ('header' in input) {
        return input.header
    }

    return null
}
