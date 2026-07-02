import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ResourcePage from './components/ResourcePage'
import Dashboard from './pages/Dashboard'
import ImportExport from './pages/ImportExport'
import { resourceList } from './resources'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {resourceList.map((r) => (
          <Route key={r.key} path={`/${r.key}`} element={<ResourcePage resource={r} />} />
        ))}
        <Route path="/import" element={<ImportExport />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
