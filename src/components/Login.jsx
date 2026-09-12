// src/components/Login.jsx

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] =
    useState("");
  const [isLoggingIn, setIsLoggingIn] =
    useState(false);
  const [error, setError] =
    useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedEmail =
      email.trim();

    if (!trimmedEmail) {
      setError(
        "Please enter your email address.",
      );
      return;
    }

    if (!password) {
      setError(
        "Please enter your password.",
      );
      return;
    }

    setIsLoggingIn(true);
    setError("");

    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword(
          {
            email: trimmedEmail,
            password,
          },
        );

      if (loginError) {
        throw loginError;
      }

      if (!data.session) {
        throw new Error(
          "Login succeeded, but no session was created.",
        );
      }

      if (onLoginSuccess) {
        onLoginSuccess(data.session);
      }
    } catch (loginError) {
      setError(
        loginError?.message ||
          "Unable to sign in. Please check your email and password.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <p className="eyebrow">
            925 Jewellery
          </p>

          <h1>Welcome back</h1>

          <p>
            Sign in to access your
            inventory.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >
          <label>
            Email

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value,
                )
              }
              placeholder="Enter your email"
              autoComplete="email"
              autoFocus
              disabled={isLoggingIn}
            />
          </label>

          <label>
            Password

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value,
                )
              }
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={isLoggingIn}
            />
          </label>

          {error && (
            <p className="auth-error">
              {error}
            </p>
          )}

          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={isLoggingIn}
          >
            {isLoggingIn
              ? "Signing in..."
              : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default Login;