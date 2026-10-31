import { createServer } from "node:http";
const port = Number(process.env.METADATA_STUB_PORT || 4199);
type Control = { failTmdb: boolean; failMovies: boolean; failAdult: boolean; malformedTmdb: boolean; malformedAdult: boolean; emptyTmdb: boolean; emptyAdult: boolean; extended: boolean; throttleMovies: boolean; missingCredits: boolean; failRelated: boolean };
const defaults = (): Control => ({ failTmdb: false, failMovies: false, failAdult: false, malformedTmdb: false, malformedAdult: false, emptyTmdb: false, emptyAdult: false, extended: false, throttleMovies: false, missingCredits: false, failRelated: false });
let control = defaults();
let requests: Array<{ path: string; search: string; input?: unknown }> = [];
const genres = [{ id: 18, name: "Drama" }, { id: 35, name: "Comedy" }, { id: 16, name: "Animation" }];
const movie = (id: number, title: string, genreId: number) => ({ id, adult: false, production_companies: [{ id: 88 }], credits: { cast: [{ id: 77, order: 0, name: "Mock Actor", character: "The Lead", profile_path: "/actor.jpg" }], crew: [{ id: 55, job: "Director" }, { id: 56, job: "Writer" }] }, aggregate_credits: { cast: [{ id: 77, order: 0, name: "Mock Actor", profile_path: "/actor.jpg", roles: [{ character: "The Lead" }] }], crew: [{ id: 55, jobs: [{ job: "Director" }] }, { id: 56, jobs: [{ job: "Writer" }] }] }, created_by: [{ id: 57 }], title, release_date: "2024-04-12", overview: "Fictional test metadata.", vote_average: 7.1, genre_ids: [genreId], genres: genres.filter(genre => genre.id === genreId), poster_path: null, runtime: 110 });
const show = (id: number, title: string, genreId: number) => ({ ...movie(id, title, genreId), name: title, first_air_date: "2023-02-03", episode_run_time: [42] });
// Who is on screen, by the ID's last digit: 1 is women only, 2 is men only, anything else mixed.
const cast = (id: string) => /2$/.test(id) ? ["MALE", "MALE"] : /1$/.test(id) ? ["FEMALE", "FEMALE"] : ["FEMALE", "MALE"];
const scene = (id: string) => ({ id, title: id === "stash-scene-1" ? "Mock Stash Scene" : `Mock Stash ${id}`, details: "Fictional test metadata.", release_date: "2024-01-01", images: [{ url: "https://images.example.test/stash.jpg" }], performers: cast(id).map((gender, index) => ({ as: null, performer: { name: index ? `Mock Stash Performer ${index + 1}` : "Mock Stash Performer", gender, images: [{ url: "https://images.example.test/person.jpg" }] } })), tags: [{ id: "tag-drama", name: "Drama" }] });
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/__control") {
    if (request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<Control> & { reset?: boolean };
      if (body.reset) { control = defaults(); requests = []; }
      for (const key of Object.keys(defaults()) as Array<keyof Control>) if (typeof body[key] === "boolean") control[key] = body[key]!;
    }
    response.end(JSON.stringify({ ok: true, requests })); return;
  }
  const requestLog: { path: string; search: string; input?: unknown } = { path: url.pathname, search: url.search };
  requests.push(requestLog);
  if (url.pathname.startsWith("/3/") && (control.failTmdb || control.failMovies && /\/(movie|discover\/movie|genre\/movie)\b/.test(url.pathname))) {
    response.statusCode = 503; response.end(JSON.stringify({ error: "Mock upstream unavailable" })); return;
  }
  if (control.throttleMovies && url.pathname === "/3/discover/movie") {
    response.statusCode = 429; response.setHeader("Retry-After", "1"); response.end("{}"); return;
  }
  if (url.pathname.startsWith("/3/") && control.malformedTmdb) { response.end("not-json"); return; }
  if ((url.pathname.startsWith("/theporndb/") || url.pathname === "/graphql") && control.failAdult) {
    response.statusCode = 503; response.end(JSON.stringify({ error: "Mock upstream unavailable" })); return;
  }
  if ((url.pathname.startsWith("/theporndb/") || url.pathname === "/graphql") && control.malformedAdult) { response.end(JSON.stringify({ data: "invalid provider shape" })); return; }
  if (/^\/3\/genre\/(movie|tv)\/list$/.test(url.pathname)) response.end(JSON.stringify({ genres }));
  else if (/^\/3\/tv\/\d+\/recommendations$/.test(url.pathname)) {
    if (control.failRelated) { response.statusCode = 503; response.end("{}"); return; }
    const page = Number(url.searchParams.get("page"));
    response.end(JSON.stringify({ results: page === 1 ? [show(9901, "Related Show", 18), { ...show(9902, "Adult result", 18), adult: true }, { ...show(9903, "Unknown flag", 18), adult: undefined }] : page === 2 ? [show(9904, "Related page two", 18)] : [], total_pages: 2 }));
  } else if (/^\/3\/person\/\d+\/tv_credits$/.test(url.pathname)) {
    response.end(JSON.stringify({ cast: [show(9910, "Person Show", 18)], crew: [{ ...show(9911, "Crew Show", 18), job: "Director" }] }));
  }
  else if (/^\/3\/discover\/(movie|tv)$/.test(url.pathname)) {
    const isMovie = url.pathname.endsWith("movie");
    const page = Number(url.searchParams.get("page"));
    const personalized = Boolean(url.searchParams.get("with_genres"));
    const credits = ["with_cast", "with_crew", "with_companies"].some(param => url.searchParams.has(param));
    const result = isMovie ? movie : show;
    const records = control.emptyTmdb ? [] : credits ? page === 1 ? [result(9920, "Credit Match", 18), ...(isMovie ? [{ ...movie(9930, "Incomplete Film", 18), release_date: "", overview: "Plot to be announced.", vote_average: 0, vote_count: 0 }, { ...movie(9931, "Unrated Film", 18), vote_average: 0, vote_count: 0 }] : [])] : [] : personalized
      ? page === 1 ? Array.from({ length: 5 }, (_, i) => result(9001 + i, `Niche Animation ${i + 1}`, 16)) : []
      : control.extended ? page <= 8 ? Array.from({ length: 20 }, (_, i) => { const id = 101 + (page - 1) * 20 + i; return result(id, `Paged ${isMovie ? "Movie" : "Show"} ${id}`, id % 3 === 1 ? 35 : 18); }) : []
      : page === 1 ? isMovie ? [movie(101, "Mock Movie One", 18), movie(102, "Mock Movie Two", 35)] : [show(201, "Mock Show One", 18), show(202, "Mock Show Two", 35)] : [];
    response.end(JSON.stringify({ results: records, total_pages: personalized ? 1 : control.extended ? 8 : 1 }));
  } else if (/^\/3\/(movie|tv)\/\d+$/.test(url.pathname)) {
    const id = Number(url.pathname.split("/").at(-1));
    if (control.missingCredits && url.searchParams.has("append_to_response")) { const record = url.pathname.includes("/tv/") ? show(id, `Mock Show ${id}`, 18) : movie(id, `Mock Movie ${id}`, 18); response.end(JSON.stringify({ ...record, credits: undefined, aggregate_credits: undefined })); return; }
    if (url.pathname.includes("/tv/")) response.end(JSON.stringify(show(id, id === 201 ? "Mock Show One" : `Mock Show ${id}`, 18)));
    else response.end(JSON.stringify(movie(id, id === 101 && !control.extended ? "Mock Movie One" : id === 102 && !control.extended ? "Mock Movie Two" : `Mock Movie ${id}`, id >= 901 && id <= 903 || id >= 9001 ? 16 : control.extended ? id % 3 === 1 ? 35 : 18 : id === 102 ? 35 : 18)));
  } else if (/^\/theporndb\/(scenes|movies)(\/[^/]+)?$/.test(url.pathname)) {
    const collection = url.pathname.split("/")[2];
    const id = url.pathname.split("/")[3];
    const kind = collection === "scenes" ? "scene" : "movie";
    const record = (sourceId: string) => ({ _id: sourceId, title: sourceId === `adult-${kind}-1` ? `Mock Adult ${kind === "scene" ? "Scene" : "Movie"}` : `Mock Adult ${sourceId}`, date: "2024-01-01", year: 2024, poster: "https://images.example.test/poster.jpg", performers: cast(sourceId).map((gender, index) => ({ name: index ? `Mock Adult Performer ${index + 1}` : "Mock Adult Performer", face: "https://images.example.test/person.jpg", extra: { gender: gender === "MALE" ? "Male" : "Female" } })), description: "Fictional test metadata.", tags: [{ name: "Drama" }] });
    const page = Number(url.searchParams.get("page") || "1");
    const records = control.emptyAdult ? [] : control.extended ? page <= 2 ? Array.from({ length: 25 }, (_, i) => record(`adult-${kind}-${(page - 1) * 25 + i + 1}`)) : [] : page === 1 ? [record(`adult-${kind}-1`), record(`adult-${kind}-2`)] : [];
    response.end(JSON.stringify(id ? { data: record(id) } : { data: records, meta: { current_page: page, last_page: control.extended ? 2 : 1 } }));
  } else if (url.pathname === "/graphql") {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { query: string; variables?: { id?: string; input?: { page: number; tags?: unknown } } };
    requestLog.input = body.variables;
    if (body.query.includes("findScene")) response.end(JSON.stringify({ data: { findScene: scene(body.variables?.id ?? "stash-scene-1") } }));
    else {
      const page = body.variables?.input?.page ?? 1;
      const personalized = Boolean(body.variables?.input?.tags);
      const records = control.emptyAdult ? [] : personalized ? page === 1 ? [scene("stash-personalized")] : [] : control.extended ? page <= 2 ? Array.from({ length: 25 }, (_, i) => scene(`stash-scene-${(page - 1) * 25 + i + 1}`)) : [] : page === 1 ? [scene("stash-scene-1")] : [];
      response.end(JSON.stringify({ data: { queryScenes: { count: control.emptyAdult ? 0 : personalized ? 1 : control.extended ? 50 : 1, scenes: records } } }));
    }
  } else { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); }
});
server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
