import { useState } from "react";
import { signIn, signUp } from "../auth.js";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const result = await signUp.email({ email, password, name: name || email });
        if (result.error) setError(result.error.message ?? "Failed");
        return;
      }

      // Sign-in: try normally first, then fall back to allowlist auto-create
      const result = await signIn.email({ email, password });
      if (!result.error) return;

      const bypass = await fetch("/api/auth/allowlist-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!bypass.ok) {
        setError(result.error.message ?? "Failed");
        return;
      }

      // Account was just auto-created — sign in now
      const retry = await signIn.email({ email, password });
      if (retry.error) setError(retry.error.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <form className="card login" onSubmit={submit}>
        <h1>XYZ Studio</h1>
        <p className="muted">
          {mode === "signin" ? "Sign in to continue" : "Sign up (allowlisted emails only)"}
        </p>
        {mode === "signup" && (
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          required
          minLength={4}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
