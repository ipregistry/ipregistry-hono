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

import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type {
    ContentfulStatusCode,
    RedirectStatusCode,
} from 'hono/utils/http-status'

import { isThreat, type ThreatOptions } from './guards.js'
import type { IpregistryContext, IpregistryLookupContext } from './types.js'

/**
 * Builds the exception thrown for denied requests, following the same
 * convention as Hono's built-in `ipRestriction` middleware: an
 * `HTTPException` carrying a ready plain-text response, so `app.onError`
 * can observe or rebrand every block in one place.
 */
function blockException(
    c: Context,
    status: ContentfulStatusCode,
    message: string,
): HTTPException {
    return new HTTPException(status, {
        res: c.text(message, status),
    })
}

/**
 * Reads the Ipregistry context set by the `ipregistry()` middleware, failing
 * loudly when the middleware is missing: a silently inactive blocker would
 * be a security hole.
 */
function requireContext(c: Context, blocker: string): IpregistryContext {
    const context = c.get('ipregistry') as IpregistryContext | undefined

    if (context === undefined) {
        throw new Error(
            `[ipregistry] ${blocker}() found no Ipregistry data on the ` +
                'context: register the ipregistry() middleware before it, ' +
                'e.g. app.use(ipregistry()).',
        )
    }

    return context
}

export interface BlockCountriesOptions {
    /**
     * ISO 3166-1 alpha-2 country codes (e.g. 'FR', 'US'), case-insensitive.
     */
    countries: string[]

    /**
     * 'block' (default) denies the listed countries; 'allow' denies every
     * country except the listed ones.
     */
    mode?: 'block' | 'allow'

    /**
     * What to do when the country is unknown (no `location.country.code` in
     * the response, or the lookup was skipped or failed). Defaults to
     * 'allow' (fail-open).
     */
    unknown?: 'allow' | 'block'

    /**
     * The HTTP status of the blocking response. Defaults to 451 (Unavailable
     * For Legal Reasons).
     */
    status?: number

    /**
     * A custom response factory replacing the default plain-text response.
     */
    response?: (
        c: Context,
        context: IpregistryContext,
    ) => Response | Promise<Response>
}

/**
 * Creates a middleware that blocks (or exclusively allows) visitors by
 * country, based on `location.country.code`. Requires the `ipregistry()`
 * middleware to run first, with a lookup that includes the `location`
 * fields.
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,location' }))
 * app.use(blockCountries({ countries: ['KP', 'IR'] }))
 * ```
 */
export function blockCountries(
    options: BlockCountriesOptions,
): MiddlewareHandler {
    const countries = new Set(
        options.countries.map((code) => code.toUpperCase()),
    )
    const mode = options.mode ?? 'block'
    const status = (options.status ?? 451) as ContentfulStatusCode

    return async function blockCountriesMiddleware(c, next) {
        const context = requireContext(c, 'blockCountries')
        const code = context.data?.location?.country?.code?.toUpperCase()

        let blocked: boolean

        if (!code) {
            blocked = options.unknown === 'block'
        } else {
            blocked =
                mode === 'block' ? countries.has(code) : !countries.has(code)
        }

        if (!blocked) {
            await next()
            return
        }

        if (options.response) {
            return options.response(c, context)
        }

        throw blockException(c, status, 'Access restricted in your region.')
    }
}

export interface BlockThreatsOptions extends ThreatOptions {
    /**
     * The HTTP status of the blocking response. Defaults to 403.
     */
    status?: number

    /**
     * A custom response factory replacing the default plain-text response.
     */
    response?: (
        c: Context,
        context: IpregistryLookupContext,
    ) => Response | Promise<Response>
}

/**
 * Creates a middleware that blocks visitors whose IP is flagged by
 * Ipregistry security data. By default blocks `is_threat`, `is_attacker`,
 * and `is_abuser`; enable `proxy`, `tor`, `vpn`, `relay`... to also block
 * anonymized traffic. Requires the `ipregistry()` middleware to run first,
 * with a lookup that includes the `security` fields. Skipped or failed
 * lookups pass through (fail-open).
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,security' }))
 * app.use(blockThreats({ tor: true, proxy: true }))
 * ```
 */
export function blockThreats(
    options: BlockThreatsOptions = {},
): MiddlewareHandler {
    const status = (options.status ?? 403) as ContentfulStatusCode

    return async function blockThreatsMiddleware(c, next) {
        const context = requireContext(c, 'blockThreats')

        if (!context.data || !isThreat(context.data, options)) {
            await next()
            return
        }

        if (options.response) {
            return options.response(c, context as IpregistryLookupContext)
        }

        throw blockException(c, status, 'Access denied.')
    }
}

export interface RedirectByCountryOptions {
    /**
     * Maps upper- or lower-case ISO 3166-1 alpha-2 country codes to a
     * destination: either a path ('/fr') resolved against the current origin
     * or an absolute URL ('https://example.de').
     */
    redirects: Record<string, string>

    /**
     * The redirect status. Defaults to 307 (temporary) so browsers do not
     * cache a geo decision; use 308 for permanent country domains.
     */
    status?: 307 | 308

    /**
     * Whether to append the current path and query to the destination, e.g.
     * FR + '/fr' turns '/pricing' into '/fr/pricing'. Defaults to false.
     */
    preservePath?: boolean
}

/**
 * Creates a middleware that redirects visitors to a country-specific path or
 * domain based on `location.country.code`. Never redirects when the visitor
 * is already under the destination (loop-safe). Requires the `ipregistry()`
 * middleware to run first, with a lookup that includes the `location`
 * fields. Skipped or failed lookups pass through untouched.
 *
 * ```ts
 * app.use(ipregistry({ fields: 'ip,location' }))
 * app.use(redirectByCountry({ redirects: { FR: '/fr', DE: '/de' } }))
 * ```
 */
export function redirectByCountry(
    options: RedirectByCountryOptions,
): MiddlewareHandler {
    const redirects = new Map(
        Object.entries(options.redirects).map(([code, destination]) => [
            code.toUpperCase(),
            destination,
        ]),
    )
    const status = (options.status ?? 307) as RedirectStatusCode

    return async function redirectByCountryMiddleware(c, next) {
        const context = requireContext(c, 'redirectByCountry')
        const code = context.data?.location?.country?.code?.toUpperCase()
        const destination = code ? redirects.get(code) : undefined

        if (!destination) {
            await next()
            return
        }

        const current = new URL(c.req.url)
        const target = destination.startsWith('/')
            ? new URL(destination, current.origin)
            : new URL(destination)

        const targetPath = target.pathname.replace(/\/$/, '')

        const alreadyThere =
            target.host === current.host &&
            (targetPath === '' ||
                current.pathname === targetPath ||
                current.pathname.startsWith(`${targetPath}/`))

        if (alreadyThere) {
            await next()
            return
        }

        if (options.preservePath) {
            target.pathname = `${targetPath}${current.pathname}`.replace(
                /\/{2,}/g,
                '/',
            )
            target.search = current.search
        }

        return c.redirect(target.toString(), status)
    }
}
