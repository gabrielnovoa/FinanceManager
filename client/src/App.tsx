import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ResourcePage from './components/ResourcePage'
import Chat from './pages/Chat'
import Dashboard from './pages/Dashboard'
import FixedCosts from './pages/FixedCosts'
import ImportExport from './pages/ImportExport'
import LookupsPage from './pages/Lookups'
import { resourceList } from './resources'

/** Tables that need more than the generic add-and-list page. */
const customPages: Record<string, () => JSX.Element> = {
  fixedcosts: FixedCosts,
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        {resourceList.map((r) => {
          const Page = customPages[r.key]
          return (
            <Route
              key={r.key}
              path={`/${r.key}`}
              element={Page ? <Page /> : <ResourcePage resource={r} />}
            />
          )
        })}
        <Route path="/lookups" element={<LookupsPage />} />
        <Route path="/import" element={<ImportExport />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
