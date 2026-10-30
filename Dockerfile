FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
WORKDIR /app
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/choice_fatigue?schema=public
ENV BETTER_AUTH_SECRET=build-only-placeholder-not-for-runtime
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
COPY docker-entrypoint.sh /usr/local/bin/choice-fatigue-entrypoint
RUN chmod 0755 /usr/local/bin/choice-fatigue-entrypoint && useradd --system --uid 10001 --create-home choicefatigue && chown -R choicefatigue:choicefatigue /app
USER choicefatigue
EXPOSE 4173
ENTRYPOINT ["choice-fatigue-entrypoint"]
