// Rendered for any unmatched route (and for the asset paths the catch-all 404s, e.g. a stray
// service-worker request). Keeps unknown paths from erroring through the docs layout.
export default function NotFound() {
  return (
    <div style={{ padding: '5rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>404 — Page not found</h1>
      <p style={{ marginTop: '0.75rem', opacity: 0.7 }}>
        That page doesn’t exist. <a href="/">Back to the docs home →</a>
      </p>
    </div>
  )
}
