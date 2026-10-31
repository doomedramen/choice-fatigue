import { providerArtworkUrl } from "@/lib/provider-artwork";

export type MediaPerson = { name: string; role?: string; imageUrl?: string };
const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 160) : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function uniquePeople(rows: Array<MediaPerson | null>): MediaPerson[] {
  const names = new Set<string>();
  return rows.filter((person): person is MediaPerson => {
    if (!person) return false;
    const key = person.name.toLocaleLowerCase();
    if (names.has(key)) return false;
    names.add(key);
    return true;
  }).slice(0, 15);
}

export function tmdbPeople(value: unknown, mediaType: "movie" | "tv"): MediaPerson[] {
  const record = object(value);
  const credits = object(mediaType === "tv" ? record.aggregate_credits : record.credits);
  return uniquePeople(list(credits.cast).map(entry => {
    const person = object(entry), name = text(person.name);
    if (!name) return null;
    const roles = list(person.roles).map(role => text(object(role).character)).filter(Boolean);
    const role = mediaType === "tv" ? roles[0] : text(person.character);
    const path = text(person.profile_path);
    const imageUrl = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(path) ? `https://image.tmdb.org/t/p/w185${path}` : undefined;
    return { name, ...(role ? { role } : {}), ...(imageUrl ? { imageUrl } : {}) };
  }));
}

export function thePornDbPeople(value: unknown): MediaPerson[] {
  return uniquePeople(list(object(value).performers).map(entry => {
    const person = object(entry), name = text(person.name);
    if (!name) return null;
    const imageUrl = providerArtworkUrl(person.face, person.thumbnail, person.image);
    return { name, ...(imageUrl ? { imageUrl } : {}) };
  }));
}

export function stashDbPeople(value: unknown): MediaPerson[] {
  return uniquePeople(list(object(value).performers).map(entry => {
    const appearance = object(entry), person = object(appearance.performer), name = text(person.name);
    if (!name) return null;
    const imageUrl = providerArtworkUrl(...list(person.images).map(image => object(image).url));
    const alias = text(appearance.as);
    return { name, ...(alias && alias !== name ? { role: `as ${alias}` } : {}), ...(imageUrl ? { imageUrl } : {}) };
  }));
}
