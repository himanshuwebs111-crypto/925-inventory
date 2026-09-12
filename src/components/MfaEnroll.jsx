// src/components/MfaEnroll.jsx

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

let enrollmentPromise = null;

function createQrImageUrl(qrCode) {
  if (!qrCode) return "";

  if (qrCode.startsWith("data:image/")) {
    return qrCode;
  }

  const svgBlob = new Blob([qrCode], {
    type: "image/svg+xml",
  });

  return URL.createObjectURL(svgBlob);
}

async function createAuthenticator() {
  if (enrollmentPromise) {
    return enrollmentPromise;
  }

  enrollmentPromise = (async () => {
    const { data: factorsData, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError) {
      throw factorsError;
    }

    const verifiedFactor = factorsData?.totp?.find(
      (factor) => factor.status === "verified",
    );

    if (verifiedFactor) {
      throw new Error(
        "An authenticator is already enrolled for this account.",
      );
    }

    const unverifiedFactor = factorsData?.totp?.find(
      (factor) => factor.status === "unverified",
    );

    if (unverifiedFactor) {
      const { error: unenrollError } =
        await supabase.auth.mfa.unenroll({
          factorId: unverifiedFactor.id,
        });

      if (unenrollError) {
        throw unenrollError;
      }
    }

    const { data, error: enrollError } =
      await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "925 Jewellery Authenticator",
      });

    if (enrollError) {
      throw enrollError;
    }

    if (
      !data?.id ||
      !data?.totp?.qr_code ||
      !data?.totp?.secret
    ) {
      throw new Error(
        "Supabase did not return the authenticator setup information.",
      );
    }

    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    };
  })();

  try {
    return await enrollmentPromise;
  } finally {
    enrollmentPromise = null;
  }
}

function MfaEnroll({ onEnrolled }) {
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let qrObjectUrl = "";

    async function loadAuthenticator() {
      setIsLoading(true);
      setError("");

      try {
        const enrollment = await createAuthenticator();

        if (cancelled) {
          return;
        }

        const imageUrl = createQrImageUrl(enrollment.qrCode);

        if (imageUrl.startsWith("blob:")) {
          qrObjectUrl = imageUrl;
        }

        setFactorId(enrollment.factorId);
        setQrCode(imageUrl);
        setSecret(enrollment.secret);
      } catch (enrollError) {
        if (!cancelled) {
          setError(
            enrollError?.message ||
              "Unable to set up your authenticator.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadAuthenticator();

    return () => {
      cancelled = true;

      if (qrObjectUrl) {
        URL.revokeObjectURL(qrObjectUrl);
      }
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedCode = code.trim();

    if (!factorId) {
      setError(
        "Authenticator setup has not completed yet.",
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
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId,
        });

      if (challengeError) {
        throw challengeError;
      }

      if (!challengeData?.id) {
        throw new Error(
          "Unable to create the authenticator verification challenge.",
        );
      }

      const { error: verifyError } =
        await supabase.auth.mfa.verify({
          factorId,
          challengeId: challengeData.id,
          code: trimmedCode,
        });

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

      if (assuranceData?.currentLevel !== "aal2") {
        throw new Error(
          "Authenticator setup completed, but the secure session could not be confirmed.",
        );
      }

      if (onEnrolled) {
        onEnrolled();
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

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">925 Jewellery</p>
            <h1>Set up security</h1>
            <p>Preparing your authenticator...</p>
          </div>
        </section>
      </main>
    );
  }

  if (error && !qrCode) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">925 Jewellery</p>
            <h1>Security setup</h1>
            <p>
              We could not prepare your authenticator.
            </p>
          </div>

          <p className="auth-error">{error}</p>

          <div className="auth-form">
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
      <section className="auth-card mfa-enroll-card">
        <div className="auth-header">
          <p className="eyebrow">925 Jewellery</p>
          <h1>Set up authenticator</h1>
          <p>
            Scan the QR code with your authenticator app,
            then enter the 6-digit code it generates.
          </p>
        </div>

        <div className="mfa-instructions">
          <div className="mfa-step">
            <strong>1.</strong>
            <span>
              Open Google Authenticator, Microsoft Authenticator,
              Authy, or another TOTP authenticator app.
            </span>
          </div>

          <div className="mfa-step">
            <strong>2.</strong>
            <span>
              Scan the QR code below.
            </span>
          </div>
        </div>

        {qrCode && (
          <div className="mfa-qr">
            <img
              src={qrCode}
              alt="Authenticator setup QR code"
            />
          </div>
        )}

        <div className="mfa-secret">
          <p>Can't scan the QR code?</p>

          <span>
            Enter this setup key manually:
          </span>

          <code>{secret}</code>
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
                const value = event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6);

                setCode(value);
                setError("");
              }}
              autoFocus
              disabled={isVerifying}
              maxLength={6}
            />
          </label>

          {error && (
            <p className="auth-error">{error}</p>
          )}

          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={
              isVerifying ||
              code.length !== 6 ||
              !factorId
            }
          >
            {isVerifying
              ? "Verifying..."
              : "Verify & Continue"}
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

export default MfaEnroll;