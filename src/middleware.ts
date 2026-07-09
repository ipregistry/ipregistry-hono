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

import { UserAgents, type IpregistryClient } from '@ipregistry/client'
import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import {
    createIpregistryClient,
    resolveEnvironment,
    toErrorInfo,
    type IpregistryConnectionOptions,
} from './config.js'
import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    type IpSource,
} from './ip.js'
import type { IpregistryContext, IpregistrySkipReason } from './types.js'

/**
 * Configuration of the `ipregistry()` middleware. Everything is optional:
 * with no configuration the middleware reads the API key from
 * `IPREGISTRY_API_KEY`, extracts the client IP from standard proxy headers,
 * caches lookups in memory, skips static assets, and fails open.
 */
export interface IpregistryOptions extends IpregistryConnectionOptions {
    /**
     * Selects the Ipregistry response fields to fetch and attach to the
     * context, as a comma-separated list (e.g. 'location,security'). Fewer
     * fields mean smaller payloads and faster requests. Defaults to the
     * `IPREGISTRY_FIELDS` environment variable, then to the full response.
     */
    fields?: string

    /**
     * Whether to resolve the hostname of the client IP. Defaults to false.
     */
    hostname?: boolean

    /**
     * Where to read the client IP from: a trusted-proxy preset ('auto',
     * 'cloudflare', 'vercel', 'nginx', 'forwarded-for'), a single trusted
     * header (`{ header: 'x-client-ip' }`), or a custom extractor function
     * (e.g. wrapping your runtime's `getConnInfo`). Only configure headers
     * your proxy actually overwrites, otherwise clients can spoof their IP.
     * Defaults to 'auto'.
     */
    ipSource?: IpSource

    /**
     * A fixed IP address used when the extracted client IP is missing or
     * private, which is the norm on localhost. Handy in development to
     * exercise geo features; leave unset in production.
     */
    developmentIp?: string

    /**
     * Whether to skip lookups for static assets (favicon and common file
     * extensions). Defaults to true so assets never consume credits; set to
     * false if your routes already exclude them or you want assets enriched
     * too.
     */
    skipStaticAssets?: boolean

    /**
     * Whether to skip lookups for search bots and crawlers, identified by
     * user agent. Pass true to use the SDK's built-in heuristic, or a
     * regular expression tested against the User-Agent header. Defaults to
     * false.
     */
    skipBots?: boolean | RegExp

    /**
     * A custom predicate deciding whether to skip the lookup for a request.
     * Runs after the static-asset and bot checks.
     */
    skip?: (c: Context) => boolean

    /**
     * When the lookup fails (timeout, API error, missing key), the
     * middleware fails open by default: the request proceeds without data.
     * Set to true to fail closed with a 503 `HTTPException` instead, or to
     * a number to choose the status. Skipped lookups (static assets, bots,
     * no IP) are unaffected.
     */
    failClosed?: boolean | number

    /**
     * Called when a lookup fails, before the fail-open/fail-closed decision.
     * Use it to report to your monitoring. The library itself never logs
     * full IP addresses; do the same in your handler.
     */
    onError?: (error: unknown, c: Context) => void

    /**
     * Whether to log skipped and failed lookups with `console.warn`
     * (IP addresses are anonymized). Defaults to false.
     */
    debug?: boolean
}

const STATIC_EXTENSIONS =
    /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|otf|pdf|png|svg|ttf|txt|wasm|webm|webp|woff2?|xml)$/i

function isStaticAssetPath(pathname: string): boolean {
    return pathname === '/favicon.ico' || STATIC_EXTENSIONS.test(pathname)
}

/**
 * Creates a Hono middleware that enriches matched requests with Ipregistry
 * data. The result is attached to the context as the `ipregistry` variable
 * and read back anywhere downstream with `c.var.ipregistry` (or
 * `getIpregistry(c)`).
 *
 * ```ts
 * import { Hono } from 'hono'
 * import { ipregistry } from '@ipregistry/hono'
 *
 * const app = new Hono()
 *
 * app.use(ipregistry({ fields: 'ip,location,security' }))
 *
 * app.get('/', (c) => {
 *     const country = c.var.ipregistry.data?.location?.country?.name
 *     return c.text(`Hello ${country ?? 'visitor'}!`)
 * })
 * ```
 *
 * The API is queried at most once per request: if the variable is already
 * set (for example by another `ipregistry()` registration on a parent
 * route), the middleware passes through untouched.
 */
export function ipregistry(options: IpregistryOptions = {}): MiddlewareHandler {
    if (options.developmentIp && !isValidIp(options.developmentIp)) {
        throw new TypeError(
            `[ipregistry] developmentIp '${options.developmentIp}' is not a ` +
                'valid IP address.',
        )
    }

    const extractIp = createIpExtractor(options.ipSource)

    // The client is created on first request, not at module evaluation, so
    // that environment bindings are available (Cloudflare Workers) and a
    // missing API key surfaces as a per-request fail-open error instead of
    // breaking the whole application at boot time.
    let client: IpregistryClient | undefined
    let fields: string | undefined
    let fieldsResolved = false

    return async function ipregistryMiddleware(c, next) {
        if (c.get('ipregistry') !== undefined) {
            await next()
            return
        }

        const skipped = resolveSkipReason(c, options)

        if (skipped) {
            c.set('ipregistry', { ip: null, data: null, skipped })
            await next()
            return
        }

        let ip = extractIp(c)

        if ((!ip || isPrivateIp(ip)) && options.developmentIp) {
            ip = options.developmentIp
        }

        if (!ip || isPrivateIp(ip)) {
            if (options.debug) {
                console.warn(
                    '[ipregistry] no public client IP found, skipping lookup',
                )
            }
            c.set('ipregistry', { ip: null, data: null, skipped: 'no-ip' })
            await next()
            return
        }

        let context: IpregistryContext

        try {
            const environment = resolveEnvironment(c)

            if (!fieldsResolved) {
                const fromEnv = environment.IPREGISTRY_FIELDS
                fields =
                    options.fields ??
                    (typeof fromEnv === 'string' && fromEnv !== ''
                        ? fromEnv
                        : undefined)
                fieldsResolved = true
            }

            client ??= createIpregistryClient(options, environment)

            const response = await client.lookupIp(ip, {
                ...(fields !== undefined ? { fields } : {}),
                ...(options.hostname !== undefined
                    ? { hostname: options.hostname }
                    : {}),
            })
            context = { ip, data: response.data }
        } catch (error) {
            options.onError?.(error, c)

            if (options.debug) {
                console.warn(
                    `[ipregistry] lookup failed for ${anonymizeIp(ip)}:`,
                    error instanceof Error ? error.message : error,
                )
            }

            if (options.failClosed) {
                const status = (
                    typeof options.failClosed === 'number'
                        ? options.failClosed
                        : 503
                ) as ContentfulStatusCode
                // Same convention as Hono's built-in middleware (timeout,
                // ipRestriction): an HTTPException with a ready response,
                // observable through app.onError.
                throw new HTTPException(status, {
                    res: c.text('Service temporarily unavailable.', status),
                })
            }

            context = { ip, data: null, error: toErrorInfo(error) }
        }

        c.set('ipregistry', context)
        await next()
    }
}

function resolveSkipReason(
    c: Context,
    options: IpregistryOptions,
): IpregistrySkipReason | null {
    if (options.skipStaticAssets !== false && isStaticAssetPath(c.req.path)) {
        return 'static-asset'
    }

    if (options.skipBots) {
        const userAgent = c.req.header('user-agent')

        if (userAgent) {
            const isBot =
                options.skipBots instanceof RegExp
                    ? options.skipBots.test(userAgent)
                    : UserAgents.isBot(userAgent)

            if (isBot) {
                return 'bot'
            }
        }
    }

    if (options.skip?.(c)) {
        return 'custom'
    }

    return null
}
