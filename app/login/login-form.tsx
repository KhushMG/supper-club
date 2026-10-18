"use client";
import { useState } from "react";
import { ArrowRight, Utensils } from "lucide-react";
export default function LoginForm({ googleEnabled, authError, returnTo }: { googleEnabled: boolean; authError?: string; returnTo: string }) {
  const [error, setError] = useState(authError || ""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <Utensils size={20} />
          </span>
          supper club<span className="brand-dot">.</span>
        </div>
        <p className="eyebrow">YOUR PRIVATE DINNER PLANNER</p>
        <h1>
          Good evenings
          <br />
          start here.
        </h1>
        <p>Sign in to your household’s weekly table.</p>
        {googleEnabled ? (
          <a className="google-signin" href={"/api/auth/google?next="+encodeURIComponent(returnTo)}>
            <span aria-hidden="true" className="google-mark">G</span>
            Continue with Google
          </a>
        ) : <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const password = new FormData(e.currentTarget).get("password");
              const r = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              const j = await r.json();
              if (!r.ok) throw new Error(j.error);
              location.href = returnTo;
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Household password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Come on in"}
            <ArrowRight size={17} />
          </button>
        </form>}
        {googleEnabled && error && <p className="error" role="alert">{error}</p>}
        <small>Private prototype · Test payments only</small>
      </div>
    </main>
  );
}
