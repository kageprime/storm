import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { ProjectView } from './pages/ProjectView'
import { Layout } from './components/Layout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const auth = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            auth.isAuthenticated ? (
              <Navigate to="/" replace />
            ) : (
              <Login onLogin={auth.login} onRegister={auth.register} />
            )
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout user={auth.user!} onLogout={auth.logout}>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ProtectedRoute>
              <Layout user={auth.user!} onLogout={auth.logout}>
                <ProjectView />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
