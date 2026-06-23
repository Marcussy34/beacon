import nextra from 'nextra'

const withNextra = nextra({
  // Nextra 4 defaults: MDX + built-in search (Pagefind) + the docs theme are enabled out of the box.
})

export default withNextra({
  reactStrictMode: true,
})
