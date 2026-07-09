import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { getIpregistry } from '../src/get.js'
import type { IpregistryContext } from '../src/types.js'
import { ipInfo } from './fixtures.js'

describe('getIpregistry', () => {
    it('returns the context set by the middleware', async () => {
        const data = ipInfo()
        const app = new Hono()
        app.use(async (c, next) => {
            c.set('ipregistry', { ip: data.ip, data })
            await next()
        })
        app.get('/', (c) => c.json(getIpregistry(c)))

        const response = await app.request('/')
        const context = (await response.json()) as IpregistryContext

        expect(context.ip).toBe(data.ip)
        expect(context.data?.location?.country?.code).toBe('US')
    })

    it('returns a no-middleware context when nothing ran', async () => {
        const app = new Hono()
        app.get('/', (c) => c.json(getIpregistry(c)))

        const response = await app.request('/')
        const context = (await response.json()) as IpregistryContext

        expect(context).toEqual({
            ip: null,
            data: null,
            skipped: 'no-middleware',
        })
    })
})
