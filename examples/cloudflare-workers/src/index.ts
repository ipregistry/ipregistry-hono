import { Hono } from 'hono'
import {
    blockThreats,
    ipregistry,
    isEuVisitor,
    redirectByCountry,
} from '@ipregistry/hono'

const app = new Hono()

// One lookup per request, cached. Select only the fields you need.
app.use(
    ipregistry({
        fields: 'ip,location,security',
        ipSource: 'cloudflare',
        // developmentIp: '66.165.2.7', // uncomment for local `wrangler dev`
    }),
)

// Block attackers and abusers everywhere; also block Tor and proxies.
app.use(blockThreats({ tor: true, proxy: true }))

// Send French and German visitors to their localized sections.
app.use(
    redirectByCountry({
        redirects: { FR: '/fr', DE: '/de' },
        preservePath: true,
    }),
)

app.get('/', (c) => {
    const { data } = c.var.ipregistry
    return c.text(
        `Hello ${data?.location?.country?.name ?? 'visitor'}!` +
            (isEuVisitor(c) ? ' (EU visitor: consent banner required)' : ''),
    )
})

app.get('/fr', (c) => c.text('Bonjour !'))
app.get('/de', (c) => c.text('Hallo!'))

// Raw context, handy while integrating.
app.get('/api/geo', (c) => c.json(c.var.ipregistry))

export default app
