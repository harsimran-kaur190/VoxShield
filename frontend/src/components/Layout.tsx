import { NavLink, Outlet } from 'react-router-dom'

import { Logo } from './Logo'

const links: { to: string; label: string; short?: string }[] = [
  { to: '/', label: 'Analyze' },
  { to: '/about', label: 'Evaluation & limits', short: 'Limits' },
]

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <NavLink to="/" aria-label="VoxShield home" className="rounded-md">
            <Logo />
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors ${
                    isActive ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
                  }`
                }
              >
                {link.short ? (
                  <>
                    <span className="sm:hidden">{link.short}</span>
                    <span className="hidden sm:inline">{link.label}</span>
                  </>
                ) : (
                  link.label
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 sm:px-6">
          <p className="font-display text-lg font-medium">Beyond the Voice. Into the Truth.</p>
          <p className="text-sm text-ink-3">AI-powered voice fraud detection and protection.</p>
        </div>
      </footer>
    </div>
  )
}
