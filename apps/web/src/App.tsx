import { Link, Navigate, Route, Routes } from "react-router-dom";
import { signOut, useSession } from "./auth.js";
import Dashboard from "./pages/Dashboard.js";
import Login from "./pages/Login.js";
import SceneDeepDive from "./pages/SceneDeepDive.js";
import SessionEditor from "./pages/SessionEditor.js";

export default function App() {
  const { data: session, isPending } = useSession();

  if (isPending) return <div className="centered">Loading…</div>;

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          XYZ Studio
        </Link>
        <span className="user">
          {session.user.email}{" "}
          <button className="link" onClick={() => signOut()}>
            Sign out
          </button>
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sessions/:id" element={<SessionEditor />} />
          <Route
            path="/sessions/:id/scene/:sceneIndex"
            element={<SceneDeepDive />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
