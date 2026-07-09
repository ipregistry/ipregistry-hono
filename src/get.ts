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

import type { IpregistryContext } from './types.js'

/**
 * Reads the Ipregistry context attached to a request by the `ipregistry()`
 * middleware. Never throws and never calls the API: when the middleware did
 * not run for this route, the returned context has null data and the
 * `no-middleware` skip reason.
 *
 * Inside handlers, `c.var.ipregistry` is equivalent whenever the middleware
 * is guaranteed to have run; `getIpregistry` is the safe form for shared
 * helpers that cannot know how the app is composed.
 */
export function getIpregistry(c: Context): IpregistryContext {
    const context = c.get('ipregistry') as IpregistryContext | undefined

    return context ?? { ip: null, data: null, skipped: 'no-middleware' }
}
