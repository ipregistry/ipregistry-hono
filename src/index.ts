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

export { ipregistry, type IpregistryOptions } from './middleware.js'
export {
    blockCountries,
    blockThreats,
    redirectByCountry,
    type BlockCountriesOptions,
    type BlockThreatsOptions,
    type RedirectByCountryOptions,
} from './blockers.js'
export { getIpregistry } from './get.js'
export {
    isBot,
    isEuVisitor,
    isThreat,
    type IpInfoInput,
    type ThreatOptions,
} from './guards.js'
export {
    createIpregistryClient,
    MissingApiKeyError,
    toErrorInfo,
    type IpregistryConnectionOptions,
} from './config.js'
export {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    sanitizeIp,
    type IpExtractor,
    type IpSource,
    type TrustedProxyPreset,
} from './ip.js'
export {
    IPREGISTRY_CONTEXT_KEY,
    type IpregistryContext,
    type IpregistryErrorInfo,
    type IpregistryLookupContext,
    type IpregistrySkipReason,
    type IpregistryVariables,
} from './types.js'

// Re-exported from the official JavaScript SDK so applications rarely need
// to depend on @ipregistry/client directly.
export type {
    Carrier,
    Company,
    Connection,
    Currency,
    IpInfo,
    Location,
    Security,
    TimeZone,
    UserAgent,
} from '@ipregistry/client'
