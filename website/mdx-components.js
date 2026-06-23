import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'
import { Callout, Steps } from 'nextra/components'

const themeComponents = getThemeComponents()

// Merge the theme's default MDX components with Nextra built-ins we use across pages
// (so .mdx files can use <Callout>/<Steps> without a per-file import) + per-page overrides.
export function useMDXComponents(components) {
  return { ...themeComponents, Callout, Steps, ...components }
}
