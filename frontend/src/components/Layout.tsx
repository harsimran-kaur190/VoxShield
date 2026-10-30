import type { LucideIcon } from 'lucide-react'
import { AudioLines, FlaskConical, History, House, Menu, PhoneCall, PhoneIncoming, ShieldCheck, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { DEMO_CALL_PATH } from '../lib/callSimulation'
import { Logo } from './Logo'
import { buttonClass } from './ui/styles'

// New top-level pages are added here and in App.tsx. Reports open from History, so they have no entry of their own.
const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/analyze', label: 'Analyze Audio', icon: AudioLines },
  { to: '/call', label: 'Live Call', icon: PhoneCall },
  { to: '/lab', label: 'Scenario Lab', icon: FlaskConical },
  { to: '/history', label: 'History', icon: History },
  { to: '/about', label: 'Evaluation & Limits', icon: ShieldCheck },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent-tint/60 text-accent-deep' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
  }`

export function Layout() {
  const menuId = useId()
  const { pathname } = useLocation()
  // Remembers the page the menu was opened on, so any navigation closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const menuOpen = openOn === pathname
  const close = () => setOpenOn(null)

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur" onKeyDown={(event) => event.key === 'Escape' && close()}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="VoxShield home" className="shrink-0 rounded-control" onClick={close}>
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end className={linkClass}>
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {/* Icon-only on phones so the logo, this button and the menu fit in 375px; the label stays as its accessible name. */}
            <Link to={DEMO_CALL_PATH} title="Launch Simulation" className={buttonClass({ size: 'sm', className: 'max-sm:w-11 max-sm:px-0' })}>
              <PhoneIncoming className="size-4" aria-hidden />
              <span className="max-sm:sr-only">Launch Simulation</span>
            </Link>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setOpenOn(menuOpen ? null : pathname)}
              className={buttonClass({ variant: 'ghost', size: 'sm', className: 'size-10 px-0 lg:hidden' })}
            >
              {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id={menuId} aria-label="Main" className="border-t border-line bg-paper px-4 pb-4 pt-2 sm:px-6 lg:hidden">
            <ul className="mx-auto flex max-w-6xl flex-col gap-1">
              {links.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} end onClick={close} className={(state) => `${linkClass(state)} flex w-full py-3`}>
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-paper-2">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 sm:px-6">
          <p className="font-semibold text-ink">Beyond the Voice. Into the Truth.</p>
          <p className="text-sm text-ink-3">AI-powered voice fraud detection and protection.</p>
        </div>
      </footer>
    </div>
  )
}
