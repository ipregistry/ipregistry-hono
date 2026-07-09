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

import type { IpInfo } from '@ipregistry/client'

/**
 * The Hono context variable used to carry Ipregistry data from the
 * middleware to downstream middleware and handlers: `c.var.ipregistry`.
 */
export const IPREGISTRY_CONTEXT_KEY = 'ipregistry'

/**
 * Why the middleware did not perform a lookup for a request.
 *
 * - `static-asset`: the path looked like a static asset (see
 *   `skipStaticAssets`).
 * - `bot`: the user agent matched the bot filter (see `skipBots`).
 * - `custom`: the `skip` callback returned true.
 * - `no-ip`: no valid, public client IP address could be extracted from the
 *   request.
 * - `no-middleware`: `getIpregistry` found no Ipregistry data on the context,
 *   which usually means the `ipregistry()` middleware did not run for this
 *   route.
 */
export type IpregistrySkipReason =
    'static-asset' | 'bot' | 'custom' | 'no-ip' | 'no-middleware'

/**
 * A safe, serializable description of a lookup failure.
 */
export interface IpregistryErrorInfo {
    /**
     * The Ipregistry API error code (e.g. 'INVALID_API_KEY') when the failure
     * came from the API, or a client-side code such as 'MISSING_API_KEY' or
     * 'CLIENT_ERROR'.
     */
    code?: string

    message: string
}

/**
 * The Ipregistry context attached to the Hono context by the `ipregistry()`
 * middleware and read back with `c.var.ipregistry` or `getIpregistry(c)`.
 */
export interface IpregistryContext {
    /**
     * The client IP address the lookup was performed for, or null when no
     * valid public IP could be extracted.
     */
    ip: string | null

    /**
     * The Ipregistry data for the client IP, or null when the lookup was
     * skipped or failed. Fields not selected via the `fields` option are
     * absent from the payload even though the `IpInfo` type declares them.
     */
    data: IpInfo | null

    /**
     * Set when the middleware deliberately skipped the lookup.
     */
    skipped?: IpregistrySkipReason

    /**
     * Set when the lookup was attempted but failed. With the default
     * fail-open behavior the request still went through.
     */
    error?: IpregistryErrorInfo
}

/**
 * An `IpregistryContext` that is guaranteed to hold lookup data.
 */
export interface IpregistryLookupContext extends IpregistryContext {
    ip: string
    data: IpInfo
}

/**
 * The context variables set by the `ipregistry()` middleware. Merge this
 * into your application's environment when you type Hono explicitly:
 *
 * ```ts
 * const app = new Hono<{ Variables: IpregistryVariables }>()
 * ```
 *
 * Apps that rely on the global `ContextVariableMap` augmentation shipped by
 * this package get typed access to `c.var.ipregistry` without it.
 */
export interface IpregistryVariables {
    ipregistry: IpregistryContext
}

declare module 'hono' {
    interface ContextVariableMap {
        ipregistry: IpregistryContext
    }
}
