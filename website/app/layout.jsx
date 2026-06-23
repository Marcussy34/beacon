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
    logo={<b>🔦 Beacon</b>}
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
