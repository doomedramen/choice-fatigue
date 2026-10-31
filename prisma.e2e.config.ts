import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL must point to a disposable *_e2e database.");
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Refusing to migrate a non-local Playwright database.");
if (!databaseName.endsWith("_e2e")) throw new Error("Refusing to migrate a database that is not explicitly named *_e2e.");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
