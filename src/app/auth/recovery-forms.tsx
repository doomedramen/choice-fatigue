"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestPasswordReset, resetPassword } from "@/lib/auth-client";
import "./auth.css";

function RecoveryShell({ children, title }: { children: React.ReactNode; title: string }) {
  return <div className="auth-page"><header className="auth-header"><Link className="auth-brand" href="/sign-in"><span className="auth-brand-mark" aria-hidden="true">✳</span>Choice Fatigue</Link><Link className="auth-back" href="/sign-in">← Sign in</Link></header><main className="auth-main"><section className="auth-card" aria-labelledby="recovery-title"><p className="auth-eyebrow">ACCOUNT RECOVERY</p><h1 id="recovery-title">{title}</h1>{children}</section></main><footer className="auth-footer">Your discovery choices stay private to your account.</footer></div>;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(""); setMessage("");
    try {
      const result = await requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
      if (result.error) setError("We couldn’t send a reset link. Check your email address and try again.");
      else setMessage("If an account uses that address, a password reset link is on its way.");
    } catch { setError("We couldn’t reach Choice Fatigue. Check your connection and try again."); }
    finally { setPending(false); }
  }

  return <RecoveryShell title="Reset your password."><p className="auth-intro">Enter the email address for your account and we’ll send a reset link.</p>{message ? <div className="auth-success" role="status"><p>{message}</p><Link href="/sign-in">Back to sign in</Link></div> : <form className="auth-form" onSubmit={submit} aria-busy={pending}><label className="auth-field">Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={pending}>{pending?"Sending…":"Send reset link"}</button></form>}</RecoveryShell>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) { setError("This reset link is incomplete. Request a new one to continue."); return; }
    setPending(true); setError("");
    try {
      const result = await resetPassword({ newPassword: password, token });
      if (result.error) setError("This reset link may have expired. Request a new link and try again.");
      else setDone(true);
    } catch { setError("We couldn’t reach Choice Fatigue. Check your connection and try again."); }
    finally { setPending(false); }
  }

  return <RecoveryShell title="Choose a new password.">{done ? <div className="auth-success" role="status"><p>Your password has been updated.</p><Link href="/sign-in">Sign in with your new password</Link></div> : <><p className="auth-intro">Use at least 8 characters for your new password.</p><form className="auth-form" onSubmit={submit} aria-busy={pending}><label className="auth-field">New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" disabled={pending}>{pending?"Updating…":"Update password"}</button></form></>}</RecoveryShell>;
}
