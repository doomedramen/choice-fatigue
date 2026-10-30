"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import "./auth.css";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode, firstAccount = false }: { mode: AuthMode; firstAccount?: boolean }) {
  const isSignUp = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (isSignUp && password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      const result = isSignUp
        ? await signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
            callbackURL: "/",
            fetchOptions: { headers: { "x-beta-invite-code": inviteCode.trim() } },
          })
        : await signIn.email({ email: email.trim(), password, callbackURL: "/" });

      if (result.error) setError(result.error.message || "We couldn’t complete that request. Please try again.");
      else window.location.replace("/");
    } catch {
      setError("We couldn’t reach Choice Fatigue. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="auth-page">
    <header className="auth-header">
      <Link className="auth-brand" href="/" aria-label="Choice Fatigue home"><span className="auth-brand-mark" aria-hidden="true">✳</span>Choice Fatigue</Link>
      <Link className="auth-back" href="/">← Back</Link>
    </header>
    <main className="auth-main">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="auth-eyebrow">{isSignUp ? firstAccount ? "FIRST ACCOUNT" : "INVITE BETA" : "WELCOME BACK"}</p>
        <h1 id="auth-title">{isSignUp ? firstAccount ? "Set up Choice Fatigue." : "Create your account." : "Sign in."}</h1>
        <p className="auth-intro">{isSignUp ? "Make room for better choices, one shortlist at a time." : "Pick up where your discovery session left off."}</p>

        {isSignUp && <p className="auth-invite-note">{firstAccount ? "This is the first account for this Choice Fatigue instance. It will become the administrator account." : "Choice Fatigue is currently invite only. Enter the invitation code you received to request an account. The code is checked with your request and isn’t saved to your profile."}</p>}

        <form className="auth-form" onSubmit={submit} aria-busy={pending}>
          {isSignUp && <label className="auth-field">Name<input name="name" autoComplete="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>}
          {isSignUp && !firstAccount && <label className="auth-field">Invitation code<input name="inviteCode" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={128} value={inviteCode} onChange={event => setInviteCode(event.target.value)} aria-describedby="invite-code-help" /><span className="auth-field-hint" id="invite-code-help">Your inviter can share this code with you.</span></label>}
          <label className="auth-field">Email address<input name="email" type="email" autoComplete="email" autoCapitalize="none" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="auth-field">Password
            <span className="auth-password-wrap"><input name="password" type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={isSignUp ? "password-help" : undefined} /><button className="auth-password-toggle" type="button" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}<span className="sr-only"> password</span></button></span>
            {isSignUp && <span className="auth-field-hint" id="password-help">Use at least 8 characters.</span>}
          </label>
          {isSignUp && <label className="auth-field">Confirm password
            <span className="auth-password-wrap"><input name="confirmPassword" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} aria-invalid={confirmPassword.length > 0 && password !== confirmPassword} aria-describedby="confirm-password-help" /><button className="auth-password-toggle" type="button" aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? "Hide" : "Show"}<span className="sr-only"> confirmation</span></button></span>
            <span className={`auth-field-hint ${confirmPassword.length > 0 && password !== confirmPassword ? "auth-field-error" : ""}`} id="confirm-password-help" aria-live="polite">{confirmPassword.length > 0 && password !== confirmPassword ? "Passwords do not match." : "Enter the same password again."}</span>
          </label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={pending}>{pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}</button>
        </form>

        <p className="auth-foot">{isSignUp ? <>Already have an account? <Link href="/sign-in">Sign in</Link></> : <><Link href="/forgot-password">Forgot your password?</Link><br/>New to Choice Fatigue? <Link href="/sign-up">{firstAccount ? "Set up the first account" : "Join with an invite"}</Link></>}</p>
      </section>
    </main>
    <footer className="auth-footer">Your discovery choices stay private to your account.</footer>
  </div>;
}
