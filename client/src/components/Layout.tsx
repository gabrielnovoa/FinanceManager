import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { languages, useI18n, type Language } from '../i18n'
import { resourceList } from '../resources'

const linkClass = ({ isActive }: { isActive: boolean }) => 'nav-link' + (isActive ? ' active' : '')

export default function Layout({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useI18n()

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">📊 Finance<span>Manager</span></div>

        <NavLink to="/" end className={linkClass}>
          <span className="ico">🏠</span> {t('nav.dashboard')}
        </NavLink>

        {resourceList.map((r) => (
          <NavLink key={r.key} to={`/${r.key}`} className={linkClass}>
            <span className="ico">{r.icon}</span> {t(r.titleKey)}
          </NavLink>
        ))}

        <NavLink to="/import" className={linkClass}>
          <span className="ico">⇄</span> {t('nav.importExport')}
        </NavLink>

        <div className="lang-picker">
          <label htmlFor="lang-select">🌐 {t('lang.label')}</label>
          <select
            id="lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {(Object.keys(languages) as Language[]).map((code) => (
              <option key={code} value={code}>
                {languages[code].flag} {languages[code].label}
              </option>
            ))}
          </select>
        </div>

        <div className="foot">{t('layout.footer')}</div>
      </aside>

      <main className="main">{children}</main>
    </div>
  )
}
