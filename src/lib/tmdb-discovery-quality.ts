/** Keep a title if it has artwork, or both a release year and a synopsis. */
export function hasUsableTmdbDiscoveryMetadata(date: unknown, poster: unknown, overview: unknown): boolean {
  const hasPoster = typeof poster === "string" && /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(poster);
  const match = typeof date === "string" ? /^(\d{4})(?:-\d{2}-\d{2})?$/.exec(date) : null;
  const hasYear = Boolean(match && Number(match[1]) >= 1880 && Number(match[1]) <= 2200);
  const hasSynopsis = typeof overview === "string" && overview.trim().length > 0;
  return hasPoster || hasYear && hasSynopsis;
}
