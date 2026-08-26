import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { languages, useI18n, type Language } from '../i18n'
import { resourceList } from '../resources'
import AccountChip from './AccountChip'
import Flag from './Flag'

const linkClass = ({ isActive }: { isActive: boolean }) => 'nav-link' + (isActive ? ' active' : '')

/** Mirror of the `max-width: 860px` breakpoint in index.css. */
const DESKTOP_QUERY = '(min-width: 861px)'

export default function Layout({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useI18n()
  const [navOpen, setNavOpen] = useState(false)

  // Collapse the drawer when the viewport grows past the breakpoint. Without this,
  // the scroll lock below could stay applied to a desktop layout that no longer
  // shows a drawer at all.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => {
      if (mq.matches) setNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [navOpen])

  const closeNav = () => setNavOpen(false)

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <header className="mobile-bar">
        <button
          type="button"
          className="nav-toggle"
          onClick={() => setNavOpen((open) => !open)}
          aria-label={navOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={navOpen}
          aria-controls="sidebar"
        >
          <span className="burger" aria-hidden="true" />
        </button>
        <span className="mobile-brand">📊 Finance<span>Manager</span></span>
      </header>

      <div className="nav-backdrop" onClick={closeNav} aria-hidden="true" />

      <aside id="sidebar" className="sidebar">
        <div className="brand">📊 Finance<span>Manager</span></div>

        <NavLink to="/" end className={linkClass} onClick={closeNav}>
          <span className="ico">🏠</span> {t('nav.dashboard')}
        </NavLink>

        {resourceList.map((r) => (
          <NavLink key={r.key} to={`/${r.key}`} className={linkClass} onClick={closeNav}>
            <span className="ico">{r.icon}</span> {t(r.titleKey)}
          </NavLink>
        ))}

        <NavLink to="/import" className={linkClass} onClick={closeNav}>
          <span className="ico">⇄</span> {t('nav.importExport')}
        </NavLink>

        <div className="lang-picker">
          <span className="lang-label" id="lang-label">🌐 {t('lang.label')}</span>
          <div className="lang-toggle" role="group" aria-labelledby="lang-label">
            {(Object.keys(languages) as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                className={`lang-opt${language === code ? ' is-active' : ''}`}
                aria-pressed={language === code}
                aria-label={languages[code].label}
                title={languages[code].label}
                onClick={() => setLanguage(code)}
              >
                <Flag code={code} />
                <span>{code.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>

        <AccountChip />
      </aside>

      <main className="main">{children}</main>
    </div>
  )
}
