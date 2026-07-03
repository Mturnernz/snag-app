import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useSession } from './hooks/useSession';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import InvitePage from './pages/InvitePage';
import SnagListPage from './pages/SnagListPage';
import SnagDetailPage from './pages/SnagDetailPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, session } = useSession();
  const location = useLocation();

  if (loading) {
    return <p style={{ padding: 24 }} className="meta">Loading…</p>;
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// Old notification emails link to /snag/:id — keep them working.
function LegacySnagRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/snags/${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<SnagListPage />} />
        <Route path="snags/:id" element={<SnagDetailPage />} />
        <Route path="snag/:id" element={<LegacySnagRedirect />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
