"use client";

import { loginAdmin } from "./conversations/actions";
import { useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      await loginAdmin(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <h1>Admin Login</h1>
        <p className="login-subtitle">Samyati Holidays</p>
        <form action={handleSubmit} className="login-form">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
          />
          {error && <p className="text-error">{error}</p>}
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}