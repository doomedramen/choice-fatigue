import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import "./provider-review.css";

export default async function ProviderReviewPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  return <main className="provider-review-page">
    <header className="provider-review-header"><a href="/admin">← Back to admin</a><span>CHOICE FATIGUE / SOURCE REVIEW</span></header>
    <section className="provider-review-intro"><p className="admin-eyebrow">DECISION RECORD</p><h1>Metadata providers</h1><p>Choice Fatigue loads popular feeds on demand. It stores provider IDs and user actions, not provider metadata.</p></section>
    <section className="provider-review-list" aria-label="Provider findings">
      <article className="provider-review-card"><span className="provider-review-status">Movies and Shows source · opt-in</span><h2>TMDB</h2><p>TMDB documents movie and TV APIs, non-commercial use with attribution, and a separate commercial license path. It requires an approved logo and the notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Its FAQ says TMDB data or images may not be used in connection with pornographic or obscene content.</p><p>Choice Fatigue uses TMDB only for Movies and Shows and excludes adult-flagged results. Adult feeds and preference history are kept separate in the app, but the FAQ does not settle whether a separate Adult section in the same server instance is permitted. This is an unresolved release gate; do not describe the combined setup as approved without clarification from TMDB.</p><div className="provider-review-links"><a href="https://developer.themoviedb.org/docs/faq" target="_blank" rel="noreferrer">TMDB API FAQ ↗</a><a href="https://developer.themoviedb.org/docs/image-basics" target="_blank" rel="noreferrer">Image URL guidance ↗</a><a href="https://www.themoviedb.org/documentation/api/terms-of-use" target="_blank" rel="noreferrer">API Terms of Use ↗</a></div></article>
      <article className="provider-review-card"><span className="provider-review-status">Selected for Adult · disabled by default</span><h2>ThePornDB + StashDB</h2><p>The Stash guide lists StashDB and ThePornDB as supported Stash-Box sources. ThePornDB publishes API docs for scene, movie, performer, and related metadata. Choice Fatigue uses these providers for Adult feeds, with administrator-managed encrypted credentials and no source artwork. The instance Adult switch and per-account grant are both required.</p><p>Feeds are bounded requests made when discovery loads. This is not a background sync. Review current request-volume guidance before a public deployment.</p><div className="provider-review-links"><a href="https://docs.stashapp.cc/beginner-guides/guide-to-scraping/" target="_blank" rel="noreferrer">Stash guide to scraping ↗</a><a href="https://docs.stashapp.cc/metadata-sources/stash-box-instances/" target="_blank" rel="noreferrer">Supported Stash-Box sources ↗</a><a href="https://api.theporndb.net/docs" target="_blank" rel="noreferrer">ThePornDB API docs ↗</a><a href="https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/" target="_blank" rel="noreferrer">Accessing StashDB ↗</a></div></article>
    </section>
    <p className="provider-review-footnote">This is an implementation planning record, not a legal determination. Recheck the providers’ current terms before launch, and confirm the hosting provider’s rules for Adult content separately.</p>
  </main>;
}
