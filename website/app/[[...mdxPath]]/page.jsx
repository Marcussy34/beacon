import { notFound } from 'next/navigation'
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '@/mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

// Every real docs route is extensionless (e.g. /guides/panel). Stray asset requests that fall
// through to this catch-all — most commonly a leftover service worker hitting /serwist/sw.js, but
// also /favicon probes, source maps, etc. — carry a file extension. Bail with a clean 404 BEFORE
// calling importPage, so Nextra never logs a MODULE_NOT_FOUND for a path that was never a page.
function isNonPagePath(mdxPath) {
  return Array.isArray(mdxPath) && mdxPath.some((seg) => seg.includes('.'))
}

export async function generateMetadata(props) {
  const params = await props.params
  if (isNonPagePath(params.mdxPath)) notFound()
  const { metadata } = await importPage(params.mdxPath)
  return metadata
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props) {
  const params = await props.params
  if (isNonPagePath(params.mdxPath)) notFound()
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath)
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  )
}
