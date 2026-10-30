import "./credits.css";
import { getTmdbProviderStatus } from "@/lib/providers/tmdb-config";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  let usesTmdb = false;
  try {
    usesTmdb = (await getTmdbProviderStatus()).enabled;
  } catch { /* Keep credits available if the database is offline. */ }

  return <main className="credits-page">
    <header className="credits-header"><a href="/">← Back to Choice Fatigue</a><span>ABOUT / CREDITS</span></header>
    <section className="credits-intro"><p className="credits-eyebrow">CREDITS</p><h1>About Choice Fatigue</h1><p>Choice Fatigue is a media discovery app for finding, comparing, and saving what to watch next.</p></section>
    {usesTmdb ? <><section className="credits-card" aria-labelledby="tmdb-credit-title">
      <img className="tmdb-logo" src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38.svg" alt="TMDB logo" width="88" height="64" />
      <div><h2 id="tmdb-credit-title">The Movie Database (TMDB)</h2><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">Visit TMDB ↗</a></div>
    </section><p className="credits-note">TMDB metadata and poster artwork are used for Movies and Shows, including anime series under Shows. Adult titles use ThePornDB and StashDB.</p></> : <p className="credits-note">TMDB metadata is not currently active or loaded in this instance.</p>}
  </main>;
}
