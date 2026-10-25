import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="py-24">
      <p className="font-mono text-sm text-ink-3">404</p>
      <h1 className="mt-2 font-display text-4xl font-medium">That page isn&apos;t here.</h1>
      <Link to="/" className="mt-6 inline-block text-accent underline underline-offset-4">
        Back to the workspace
      </Link>
    </div>
  )
}
