import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import "./provider-review.css";

export default async function ProviderReviewPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  return <main className="provider-review-page">
    <header className="provider-review-header"><a href="/admin">← Back to admin</a><span>CHOICE FATIGUE / SOURCE REVIEW</span></header>
    <section className="provider-review-intro"><p className="admin-eyebrow">DECISION RECORD</p><h1>Metadata providers</h1><p>These checks guide what can be connected to a hosted Choice Fatigue instance. No provider API calls are active; the catalogue still uses local fixtures.</p></section>
    <section className="provider-review-list" aria-label="Provider findings">
      <article className="provider-review-card"><span className="provider-review-status">Movies, TV, and Anime source</span><h2>TMDB</h2><p>TMDB documents movie and TV APIs, non-commercial use with attribution, and a separate commercial license path. It requires an approved logo and the notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Its legal notice also prohibits using its data or images in connection with pornographic or obscene content.</p><p>Choice Fatigue will keep TMDB data in Movies, TV, and Anime, and use ThePornDB/StashDB for Adult. The Adult source boundary needs to remain clear in code and deployment. The accessible developer docs do not settle metadata cache or retention duration.</p><div className="provider-review-links"><a href="https://developer.themoviedb.org/docs/faq" target="_blank" rel="noreferrer">TMDB API FAQ ↗</a><a href="https://developer.themoviedb.org/docs/image-basics" target="_blank" rel="noreferrer">Image URL guidance ↗</a><a href="https://www.themoviedb.org/documentation/api/terms-of-use" target="_blank" rel="noreferrer">API Terms of Use ↗</a></div></article>
      <article className="provider-review-card"><span className="provider-review-status">Selected for the Adult catalogue</span><h2>ThePornDB + StashDB</h2><p>The Stash guide documents connecting both StashDB and ThePornDB to a Stash installation as Stash-Box sources. ThePornDB also publishes API documentation for scenes, movies, performers, studios, and related metadata. We’ll build against these supported endpoints with credentials kept server-side; Choice Fatigue will use their metadata only in the age-gated Adult category and will not need explicit artwork for the first integration.</p><p>The cited Stash guide describes a user’s own Stash library, so it does not define Choice Fatigue’s deployment, request-volume, or cache policy. Check current API usage guidance as part of beta preparation.</p><div className="provider-review-links"><a href="https://docs.stashapp.cc/beginner-guides/guide-to-scraping/" target="_blank" rel="noreferrer">Stash guide to scraping ↗</a><a href="https://docs.stashapp.cc/metadata-sources/stash-box-instances/" target="_blank" rel="noreferrer">Supported Stash-Box sources ↗</a><a href="https://api.theporndb.net/docs" target="_blank" rel="noreferrer">ThePornDB API docs ↗</a><a href="https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/" target="_blank" rel="noreferrer">Accessing StashDB ↗</a></div></article>
    </section>
    <p className="provider-review-footnote">This is an implementation planning record, not a legal determination. Recheck the providers’ current terms before launch, and confirm the hosting provider’s rules for Adult content separately.</p>
  </main>;
}
