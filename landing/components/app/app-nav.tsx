'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { ConnectWallet } from './connect-wallet'

const navLinks = [
  { name: 'Deposit', href: '/deposit' },
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Tracking', href: '/tracking' },
]

/**
 * App navbar — visually identical to the landing page <Navigation/>: a
 * scroll-aware floating bar that starts transparent (white text) and collapses
 * into a rounded glass pill once scrolled. Differences from the marketing nav:
 *   • links are internal app routes with an active state
 *   • the right-hand CTA is the Connect / Disconnect wallet pill
 */
export function AppNav() {
  const pathname = usePathname()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={`fixed z-50 transition-all duration-500 ${
        isScrolled ? 'top-4 left-4 right-4' : 'top-0 left-0 right-0'
      }`}
    >
      <nav
        className={`mx-auto transition-all duration-500 ${
          isScrolled || isMobileMenuOpen
            ? 'bg-background/80 backdrop-blur-xl border border-foreground/10 rounded-2xl shadow-lg max-w-[1200px]'
            : 'bg-transparent max-w-[1400px]'
        }`}
      >
        <div
          className={`flex items-center justify-between transition-all duration-500 px-6 lg:px-8 ${
            isScrolled ? 'h-14' : 'h-20'
          }`}
        >
          {/* Logo → back to marketing landing */}
          <Link href="/" className="flex items-center gap-2 group">
            <span
              className={`font-display tracking-tight transition-all duration-500 ${
                isScrolled ? 'text-xl text-foreground' : 'text-2xl text-white'
              }`}
            >
              ORBIT
            </span>
            <span
              className={`font-mono transition-all duration-500 ${
                isScrolled ? 'text-[10px] mt-0.5 text-muted-foreground' : 'text-xs mt-1 text-white/60'
              }`}
            >
              PROTOCOL
            </span>
          </Link>

          {/* Desktop navigation */}
          <div className="hidden md:flex items-center gap-12">
            {navLinks.map((link) => {
              const active = pathname?.startsWith(link.href)
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`text-sm transition-colors duration-300 relative group ${
                    isScrolled
                      ? active
                        ? 'text-foreground'
                        : 'text-foreground/70 hover:text-foreground'
                      : active
                        ? 'text-white'
                        : 'text-white/70 hover:text-white'
                  }`}
                >
                  {link.name}
                  <span
                    className={`absolute -bottom-1 left-0 h-px transition-all duration-300 group-hover:w-full ${
                      active ? 'w-full' : 'w-0'
                    } ${isScrolled ? 'bg-foreground' : 'bg-white'}`}
                  />
                </Link>
              )
            })}
          </div>

          {/* Desktop CTA — wallet */}
          <div className="hidden md:flex items-center gap-4">
            <ConnectWallet isScrolled={isScrolled} />
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={`md:hidden p-2 transition-colors duration-500 ${
              isScrolled || isMobileMenuOpen ? 'text-foreground' : 'text-white'
            }`}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile full-screen menu */}
      <div
        className={`md:hidden fixed inset-0 bg-background z-40 transition-all duration-500 ${
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ top: 0 }}
      >
        <div className="flex flex-col h-full px-8 pt-28 pb-8">
          <div className="flex-1 flex flex-col justify-center gap-8">
            {navLinks.map((link, i) => {
              const active = pathname?.startsWith(link.href)
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`text-5xl font-display transition-all duration-500 ${
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  } ${isMobileMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                  style={{ transitionDelay: isMobileMenuOpen ? `${i * 75}ms` : '0ms' }}
                >
                  {link.name}
                </Link>
              )
            })}
          </div>

          <div
            className={`flex pt-8 border-t border-foreground/10 transition-all duration-500 ${
              isMobileMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: isMobileMenuOpen ? '300ms' : '0ms' }}
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <ConnectWallet isScrolled />
          </div>
        </div>
      </div>
    </header>
  )
}
