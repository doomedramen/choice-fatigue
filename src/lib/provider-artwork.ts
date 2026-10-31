/** Use only public HTTPS image URLs; never send provider credentials to the browser. */
export function providerArtworkUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string" || value.length > 2048) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) return url.href;
    } catch { /* Missing or malformed artwork is optional. */ }
  }
  return undefined;
}
