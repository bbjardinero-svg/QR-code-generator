import { useState, type FormEvent } from "react";

interface LoginPageProps {
  onLogin: (passphrase: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onLogin(passphrase);
    } catch {
      setError("That passphrase was not accepted. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story" aria-labelledby="login-title">
        <div className="brand brand--light" aria-label="EverQR">
          <span className="brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>EverQR</span>
        </div>
        <div>
          <p className="eyebrow">Your private QR workspace</p>
          <h1 id="login-title">QR codes that stay yours.</h1>
          <p>Create stable routes for links and files, then keep them useful for years—not for the life of a subscription.</p>
        </div>
        <div className="route-thread" aria-hidden="true">
          <span>printed QR</span><i /><span>/r/your-name</span><i /><span>current content</span>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-form-title">
        <div className="login-panel__inner">
          <p className="eyebrow">Single-admin access</p>
          <h2 id="login-form-title">Open your QR registry</h2>
          <p>Use the private passphrase configured for this deployment.</p>
          <form onSubmit={submit}>
            <label htmlFor="passphrase">Admin passphrase</label>
            <input
              id="passphrase"
              name="passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              aria-invalid={error ? "true" : "false"}
              aria-describedby={error ? "login-error" : "login-help"}
              required
            />
            <p id="login-help" className="field-help">Your passphrase never appears in the dashboard or exports.</p>
            {error ? <p id="login-error" className="form-error" role="alert">{error}</p> : null}
            <button className="button button--primary button--wide" type="submit" disabled={busy || !passphrase}>
              {busy ? "Checking…" : "Open dashboard"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
