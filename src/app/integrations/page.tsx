import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import Link from "next/link";
import styles from "./integrations.module.css";

export const metadata: Metadata = { title: "Connections | Choice Fatigue" };

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role === "admin") redirect("/admin?section=services");

  return <div className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span aria-hidden="true">✳</span> Choice Fatigue</Link><Link href="/" className={styles.back}>← Back to discovery</Link></header>
    <main className={styles.main}>
      <div className={styles.intro}><p className={styles.eyebrow}>INSTANCE SERVICES</p><h1>Connections</h1><p>Media services are configured by this instance’s administrator and shared with everyone using Choice Fatigue.</p></div>
      <section className={styles.noticePanel} aria-label="Shared service connections"><span className={styles.lockIcon} aria-hidden="true">⌑</span><div><strong>Set up once for this instance</strong><p>When Seerr or Plex is configured, you can use it from the Saved list. Ask your administrator if a service you need is missing.</p></div></section>
    </main>
  </div>;
}
