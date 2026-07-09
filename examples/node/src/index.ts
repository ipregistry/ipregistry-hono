import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { blockCountries, ipregistry } from '@ipregistry/hono'

const app = new Hono()

app.use(
    ipregistry({
        fields: 'ip,location,security',
        // Directly exposed server: read the IP from the TCP connection.
        // Behind a reverse proxy, use ipSource: 'nginx' (or another preset)
        // instead, and never trust conninfo through a proxy.
        ipSource: getConnInfo,
        // developmentIp: '66.165.2.7', // uncomment for localhost testing
    }),
)

// Only serve the US and Canada on /store.
app.use('/store/*', blockCountries({ countries: ['US', 'CA'], mode: 'allow' }))

app.get('/', (c) => {
    const { data } = c.var.ipregistry
    return c.text(`Hello ${data?.location?.country?.name ?? 'visitor'}!`)
})

app.get('/store', (c) => c.text('Welcome to the store!'))

// Raw context, handy while integrating.
app.get('/api/geo', (c) => c.json(c.var.ipregistry))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
    console.log(`Listening on http://localhost:${info.port}`)
})
