// src/components/MfaVerify.jsx

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function MfaVerify({ onVerified, onEnroll }) {
  const [factorId, setFactorId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [hasVerifiedFactor, setHasVerifiedFactor] =
    useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadMfaFactor() {
      setIsLoading(true);
      setError("");

      try {
        const { data, error: factorsError } =
          await supabase.auth.mfa.listFactors();

        if (factorsError) {
          throw factorsError;
        }

        const verifiedTotpFactor =
          data?.totp?.find(
            (factor) =>
              factor.status === "verified",
          );

        if (!cancelled) {
          if (verifiedTotpFactor) {
            setFactorId(
              verifiedTotpFactor.id,
            );
            setHasVerifiedFactor(true);
          } else {
            setFactorId("");
            setHasVerifiedFactor(false);
          }
        }
      } catch (factorError) {
        if (!cancelled) {
          setError(
            factorError?.message ||
              "Unable to load your authenticator.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadMfaFactor();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedCode = code.trim();

    if (!factorId) {
      setError(
        "No verified authenticator was found.",
      );
      return;
    }

    if (!/^\d{6}$/.test(trimmedCode)) {
      setError(
        "Please enter the 6-digit code from your authenticator app.",
      );
      return;
    }

    setIsVerifying(true);
    setError("");

    try {
      const { error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify(
          {
            factorId,
            code: trimmedCode,
          },
        );

      if (verifyError) {
        throw verifyError;
      }

      const {
        data: assuranceData,
        error: assuranceError,
      } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (assuranceError) {
        throw assuranceError;
      }

      if (
        assuranceData?.currentLevel !==
        "aal2"
      ) {
        throw new Error(
          "Authenticator verification did not complete.",
        );
      }

      if (onVerified) {
        onVerified();
      }
    } catch (verifyError) {
      setError(
        verifyError?.message ||
          "The authenticator code is incorrect.",
      );
      setCode("");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleEnroll() {
    if (onEnroll) {
      onEnroll();
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">
              925 Jewellery
            </p>

            <h1>Security check</h1>

            <p>
              Checking your authenticator...
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!hasVerifiedFactor) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">
              925 Jewellery
            </p>

            <h1>Set up security</h1>

            <p>
              Your account does not have an
              authenticator set up yet. Set one
              up before accessing your inventory.
            </p>
          </div>

          {error && (
            <p className="auth-error">
              {error}
            </p>
          )}

          <div className="auth-form">
            <button
              className="primary-button auth-submit"
              type="button"
              onClick={handleEnroll}
            >
              Set Up Authenticator
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={handleLogout}
            >
              Sign Out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <p className="eyebrow">
            925 Jewellery
          </p>

          <h1>Verify your identity</h1>

          <p>
            Enter the 6-digit code from your
            authenticator app to continue.
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={handleSubmit}
        >
          <label>
            Authenticator Code

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(event) => {
                const value =
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6);

                setCode(value);
              }}
              autoFocus
              disabled={isVerifying}
              maxLength={6}
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
            disabled={
              isVerifying ||
              code.length !== 6
            }
          >
            {isVerifying
              ? "Verifying..."
              : "Verify Code"}
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleLogout}
            disabled={isVerifying}
          >
            Sign Out
          </button>
        </form>
      </section>
    </main>
  );
}

export default MfaVerify;