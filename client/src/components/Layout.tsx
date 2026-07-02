import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { resourceList } from '../resources'

const linkClass = ({ isActive }: { isActive: boolean }) => 'nav-link' + (isActive ? ' active' : '')

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">📊 Finance<span>Manager</span></div>

        <NavLink to="/" end className={linkClass}>
          <span className="ico">🏠</span> Dashboard
        </NavLink>

        {resourceList.map((r) => (
          <NavLink key={r.key} to={`/${r.key}`} className={linkClass}>
            <span className="ico">{r.icon}</span> {r.title}
          </NavLink>
        ))}

        <NavLink to="/import" className={linkClass}>
          <span className="ico">⇄</span> Import / Export
        </NavLink>

        <div className="foot">Finance Manager · runs locally &amp; on Azure</div>
      </aside>

      <main className="main">{children}</main>
    </div>
  )
}
