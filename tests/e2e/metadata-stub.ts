import { createServer } from "node:http";

const port = Number(process.env.METADATA_STUB_PORT || 4199);
let failTmdb = false;
let failAdult = false;
let malformedTmdb = false;
let malformedAdult = false;
let emptyTmdb = false;
let emptyAdult = false;

const movie = (id: number, title: string, genreId: number) => ({ id, adult: false, title, release_date: "2024-04-12", overview: "Fictional test metadata.", vote_average: 7.1, genre_ids: [genreId], poster_path: null });
const show = (id: number, title: string, genreId: number) => ({ id, adult: false, name: title, first_air_date: "2023-02-03", overview: "Fictional test metadata.", vote_average: 7.3, genre_ids: [genreId], poster_path: null });

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/__control" && request.method === "GET") { response.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === "/__control" && request.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { failTmdb?: boolean; failAdult?: boolean; malformedTmdb?: boolean; malformedAdult?: boolean; emptyTmdb?: boolean; emptyAdult?: boolean };
    failTmdb = body.failTmdb ?? failTmdb;
    failAdult = body.failAdult ?? failAdult;
    malformedTmdb = body.malformedTmdb ?? malformedTmdb;
    malformedAdult = body.malformedAdult ?? malformedAdult;
    emptyTmdb = body.emptyTmdb ?? emptyTmdb;
    emptyAdult = body.emptyAdult ?? emptyAdult;
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname.startsWith("/3/") && failTmdb) {
    response.statusCode = 503;
    response.end(JSON.stringify({ status_message: "Mock upstream unavailable" }));
    return;
  }
  if (url.pathname.startsWith("/3/") && malformedTmdb) { response.end("not-json"); return; }
  if ((url.pathname.startsWith("/theporndb/") || url.pathname === "/graphql") && failAdult) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: "Mock upstream unavailable" }));
    return;
  }
  if ((url.pathname.startsWith("/theporndb/") || url.pathname === "/graphql") && malformedAdult) { response.end(JSON.stringify({ data: "invalid provider shape" })); return; }
  if (url.pathname === "/3/genre/movie/list") response.end(JSON.stringify({ genres: [{ id: 18, name: "Drama" }, { id: 35, name: "Comedy" }] }));
  else if (url.pathname === "/3/genre/tv/list") response.end(JSON.stringify({ genres: [{ id: 18, name: "Drama" }, { id: 35, name: "Comedy" }] }));
  else if (url.pathname === "/3/discover/movie") response.end(JSON.stringify({ results: emptyTmdb || Number(url.searchParams.get("page")) > 2 ? [] : [movie(101, "Mock Movie One", 18), movie(102, "Mock Movie Two", 35)], total_pages: 2 }));
  else if (url.pathname === "/3/discover/tv") response.end(JSON.stringify({ results: emptyTmdb || Number(url.searchParams.get("page")) > 2 ? [] : [show(201, "Mock Show One", 18), show(202, "Mock Show Two", 35)], total_pages: 2 }));
  else if (url.pathname === "/3/movie/101") response.end(JSON.stringify({ ...movie(101, "Mock Movie One", 18), runtime: 110, genres: [{ name: "Drama" }] }));
  else if (url.pathname === "/3/tv/201") response.end(JSON.stringify({ ...show(201, "Mock Show One", 18), episode_run_time: [42], genres: [{ name: "Drama" }] }));
  else if (url.pathname === "/theporndb/scenes") response.end(JSON.stringify({ data: emptyAdult ? [] : [{ _id: "adult-scene-1", title: "Mock Adult Scene", date: "2024-01-01", description: "Fictional adult metadata for automated testing.", tags: [{ name: "Drama" }] }] }));
  else if (url.pathname === "/theporndb/scenes/adult-scene-1") response.end(JSON.stringify({ data: { _id: "adult-scene-1", title: "Mock Adult Scene", date: "2024-01-01", description: "Fictional adult metadata for automated testing.", tags: [{ name: "Drama" }] } }));
  else if (url.pathname === "/theporndb/movies") response.end(JSON.stringify({ data: [{ _id: "adult-movie-1", title: "Mock Adult Movie", year: 2024, description: "Fictional adult metadata for automated testing." }] }));
  else if (url.pathname === "/theporndb/movies/adult-movie-1") response.end(JSON.stringify({ data: { _id: "adult-movie-1", title: "Mock Adult Movie", year: 2024, description: "Fictional adult metadata for automated testing." } }));
  else if (url.pathname === "/graphql") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    if (body.includes("findScene")) response.end(JSON.stringify({ data: { findScene: { id: "stash-scene-1", title: "Mock Stash Scene", details: "Fictional adult metadata for automated testing.", release_date: "2024-01-01", tags: [{ name: "Drama" }] } } }));
    else response.end(JSON.stringify({ data: { queryScenes: { count: 1, scenes: emptyAdult ? [] : [{ id: "stash-scene-1", title: "Mock Stash Scene", details: "Fictional adult metadata for automated testing.", release_date: "2024-01-01", tags: [{ name: "Drama" }] }] } } }));
  }
  else { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); }
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
