import { Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'

export const metadata = {
  title: { default: 'Beacon', template: '%s — Beacon' },
  description:
    'Mission control for your AI coding agents — watch every Claude Code and Codex CLI session across all your repos.',
}

const navbar = (
  <Navbar
    logo={
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {/* Fix the SVG size inside Nextra's logo slot and use the canonical Beacon ring. */}
        <img
          src="/favicon.svg"
          alt=""
          aria-hidden="true"
          width="20"
          height="20"
          style={{ display: 'block', flex: '0 0 auto' }}
        />
        <span>Beacon</span>
      </span>
    }
    projectLink="https://github.com/Marcussy34/beacon"
  />
)

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/Marcussy34/beacon/tree/main/website"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
