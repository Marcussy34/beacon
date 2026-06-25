import nextra from 'nextra'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

const withNextra = nextra({
  // Nextra 4 defaults: MDX + built-in search (Pagefind) + the docs theme are enabled out of the box.
})

export default withNextra({
  reactStrictMode: true,
  // Keep Turbopack scoped to this docs app when parent folders also contain lockfiles.
  turbopack: {
    root: projectRoot,
  },
})
