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

import {
    ApiError,
    ClientError,
    InMemoryCache,
    IpregistryClient,
    NoCache,
    type IpregistryCache,
} from '@ipregistry/client'
import type { Context } from 'hono'
import { env } from 'hono/adapter'

import type { IpregistryErrorInfo } from './types.js'

/**
 * Connection settings for the Ipregistry API. Every field can also be
 * provided through environment variables, which is the recommended way to
 * keep the API key out of the codebase:
 *
 * - `IPREGISTRY_API_KEY`
 * - `IPREGISTRY_BASE_URL` (accepts the 'eu' shorthand)
 * - `IPREGISTRY_TIMEOUT` (milliseconds)
 * - `IPREGISTRY_FIELDS` (comma-separated field selection)
 *
 * Environment variables are resolved per runtime with Hono's `env()`
 * adapter, so they work the same on Node.js, Bun, Deno, and Cloudflare
 * Workers bindings. Explicit options take precedence over environment
 * variables.
 */
export interface IpregistryConnectionOptions {
    /**
     * The Ipregistry API key. Defaults to the `IPREGISTRY_API_KEY`
     * environment variable (or Workers binding). This value stays on the
     * server; the library never issues requests from the browser.
     */
    apiKey?: string

    /**
     * The Ipregistry API base URL, or the shorthand 'eu' for the European
     * Union endpoint. Defaults to the `IPREGISTRY_BASE_URL` environment
     * variable, then to the default endpoint.
     */
    baseUrl?: string

    /**
     * The lookup timeout in milliseconds. Defaults to the
     * `IPREGISTRY_TIMEOUT` environment variable, then 3000. The default is
     * lower than the SDK's because the lookup sits on the request path of
     * every matched request.
     */
    timeout?: number

    /**
     * The maximum number of automatic retries. Defaults to 0: retrying with
     * backoff inside middleware would stall responses, and the default
     * fail-open behavior is preferable to added latency.
     */
    maxRetries?: number

    /**
     * The cache used to avoid repeated lookups for the same IP. Defaults to
     * the SDK's `InMemoryCache` (2048 entries, 10-minute expiry) shared
     * across requests handled by the same runtime instance. Pass any
     * `IpregistryCache` implementation to plug a custom store, or false to
     * disable caching.
     */
    cache?: IpregistryCache | false

    /**
     * A pre-configured `IpregistryClient` to use instead of building one
     * from the options above. Useful for tests and advanced setups.
     */
    client?: IpregistryClient
}

/**
 * A `ClientError` raised before any request is made when no API key is
 * configured. Carries the same code as the API's MISSING_API_KEY error so
 * error handling can treat both alike.
 */
export class MissingApiKeyError extends ClientError {
    public readonly code = 'MISSING_API_KEY'

    constructor() {
        super(
            'Missing Ipregistry API key: set the IPREGISTRY_API_KEY ' +
                'environment variable (or Workers binding) or pass the ' +
                'apiKey option.',
        )
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Resolves the environment for a request: Hono's `env()` adapter (process
 * env on Node.js/Bun, `Deno.env` on Deno, bindings on Cloudflare Workers)
 * merged with `c.env` so explicitly provided bindings always win.
 */
export function resolveEnvironment(c: Context): Record<string, unknown> {
    let adapterEnv: Record<string, unknown> = {}

    try {
        adapterEnv = env<Record<string, unknown>>(c) ?? {}
    } catch {
        // Deno without --allow-env, or an exotic runtime: fall back to c.env.
    }

    const contextEnv =
        typeof c.env === 'object' && c.env !== null
            ? (c.env as Record<string, unknown>)
            : {}

    return { ...adapterEnv, ...contextEnv }
}

function envString(
    environment: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = environment[key]
    return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Builds the `IpregistryClient` used by the middleware, merging explicit
 * options with the resolved environment.
 */
export function createIpregistryClient(
    options: IpregistryConnectionOptions = {},
    environment: Record<string, unknown> = (
        globalThis as { process?: { env?: Record<string, unknown> } }
    ).process?.env ?? {},
): IpregistryClient {
    if (options.client) {
        return options.client
    }

    if (typeof window !== 'undefined') {
        throw new ClientError(
            '@ipregistry/hono must only run on the server: running it in ' +
                'the browser would expose your API key.',
        )
    }

    const apiKey =
        options.apiKey ?? envString(environment, 'IPREGISTRY_API_KEY')

    if (!apiKey) {
        throw new MissingApiKeyError()
    }

    const timeoutFromEnv = Number(envString(environment, 'IPREGISTRY_TIMEOUT'))

    return new IpregistryClient({
        apiKey,
        baseUrl:
            options.baseUrl ?? envString(environment, 'IPREGISTRY_BASE_URL'),
        timeout:
            options.timeout ??
            (Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0
                ? timeoutFromEnv
                : 3000),
        maxRetries: options.maxRetries ?? 0,
        cache:
            options.cache === false
                ? new NoCache()
                : (options.cache ?? new InMemoryCache()),
    })
}

/**
 * Converts any thrown value into the serializable error info attached to the
 * Ipregistry context. Never includes stack traces or request details.
 */
export function toErrorInfo(error: unknown): IpregistryErrorInfo {
    if (error instanceof ApiError) {
        return { code: error.code, message: error.message }
    }

    if (error instanceof MissingApiKeyError) {
        return { code: error.code, message: error.message }
    }

    if (error instanceof Error) {
        return { code: 'CLIENT_ERROR', message: error.message }
    }

    return { code: 'CLIENT_ERROR', message: String(error) }
}
