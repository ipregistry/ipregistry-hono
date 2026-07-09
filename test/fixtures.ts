import type { IpInfo } from '@ipregistry/client'

/**
 * Builds a minimal IpInfo test payload. Only the fields relevant to the
 * middleware and guards are populated; the shape mirrors the official SDK
 * model (the API omits unselected fields at runtime as well).
 */
export function ipInfo(overrides: Partial<IpInfo> = {}): IpInfo {
    const base = {
        ip: '66.165.2.7',
        type: 'IPv4',
        location: {
            continent: { code: 'NA', name: 'North America' },
            country: {
                code: 'US',
                name: 'United States',
            },
            region: { code: 'US-CA', name: 'California' },
            city: 'Los Angeles',
            in_eu: false,
        },
        security: {
            is_abuser: false,
            is_attacker: false,
            is_bogon: false,
            is_cloud_provider: false,
            is_proxy: false,
            is_relay: false,
            is_tor: false,
            is_tor_exit: false,
            is_anonymous: false,
            is_threat: false,
            is_vpn: false,
        },
    }

    return { ...base, ...overrides } as IpInfo
}

export function euIpInfo(overrides: Partial<IpInfo> = {}): IpInfo {
    return ipInfo({
        ip: '2.2.2.2',
        location: {
            continent: { code: 'EU', name: 'Europe' },
            country: { code: 'FR', name: 'France' },
            region: { code: 'FR-IDF', name: 'Île-de-France' },
            city: 'Paris',
            in_eu: true,
        },
    } as Partial<IpInfo>)
}
