# Self-hosting Choice Fatigue

Choice Fatigue 1.0 supports Docker Compose and Debian 13 Proxmox LXC deployments. Both run the Next.js app and PostgreSQL on the same trusted instance. Put a reverse proxy with HTTPS in front of the app before allowing remote access.

## Docker Compose

Install Docker Engine and the Compose plugin. From the project checkout:

```sh
cp deploy/env.compose.example deploy/env.compose
openssl rand -hex 32
openssl rand -base64 48
openssl rand -base64 32
```

Put the generated values in `deploy/env.compose` as `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, and `INTEGRATION_CREDENTIALS_KEY`. Set `BETTER_AUTH_URL` to the exact public HTTPS URL used by browsers. Keep the file private and back up the credential-encryption key separately; losing it makes saved provider and service credentials unreadable.

Start or upgrade the instance with:

```sh
docker compose --env-file deploy/env.compose -f docker-compose.release.yml up -d --build
```

The app applies checked-in database migrations before starting. PostgreSQL data lives in the `choice_fatigue_data` volume. The app health endpoint is `GET /api/health`; it returns only readiness and HTTP 503 when PostgreSQL is unavailable.

Back up the database and the deployment secrets together. For example, from the project directory:

```sh
docker compose --env-file deploy/env.compose -f docker-compose.release.yml exec -T postgres pg_dump -U choice_fatigue choice_fatigue > choice-fatigue.sql
```

Restore the SQL dump into a fresh PostgreSQL 17 instance before starting the app. Preserve `BETTER_AUTH_SECRET` and `INTEGRATION_CREDENTIALS_KEY` across upgrades and restores. Test restore procedures before relying on the backup.

## Proxmox LXC

Run the installer from a root shell on the Proxmox VE host:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/doomedramen/choice-fatigue/main/ct/choicefatigue.sh)"
```

This uses the [Community Scripts core](https://github.com/community-scripts/core) to create and configure an unprivileged Debian 13 LXC. The default allocation is 2 CPU cores, 4 GB memory, and 6 GB storage; the Community Scripts advanced setup lets the operator change the container resources, networking, and storage. The installer detects the container IPv4 address and sets `BETTER_AUTH_URL` to `http://<LXC-IP>:4173`, so the app can be opened on a trusted local network without a domain or reverse proxy.

The app installer currently tracks the public `main` branch because the project has no GitHub release yet. When releases are published, switch the installer to the release-based updater. The Community Scripts update command inside the container checks and deploys newer `main` commits, creates a PostgreSQL dump before app updates, rebuilds the app, applies database migrations, and restarts the service.

For local development, run the Community Scripts entry point from a checkout on the Proxmox host:

```sh
cd /path/to/choice-fatigue
bash ct/choicefatigue.sh
```

The in-container installer uses the Community Scripts helpers for Debian updates, PostgreSQL 17, and Node.js 22, then installs pnpm 12.16.1, generates the authentication and credential-encryption secrets, builds the app, applies migrations, and creates the `choice-fatigue` systemd service on port 4173. The database and `.env` live in the container's persistent storage.

Open `http://<LXC-IP>:4173` from a trusted local network. When you are ready to add a reverse proxy, point it at the LXC address on port 4173, then change `BETTER_AUTH_URL` in `/opt/choice-fatigue/.env` to the exact browser-facing URL (for example `https://choice.example.com`) and run `systemctl restart choice-fatigue`. This keeps authentication origin checks and cookies aligned with the URL users open. Check the service with `systemctl status choice-fatigue` and `curl http://127.0.0.1:4173/api/health`; use `journalctl -u choice-fatigue` for logs.

## First-run setup and access

Open the public URL and register the first account; it becomes the administrator. In Admin settings, set a reusable invite code and share it manually with people who may register. There is no email invitation flow. Admins can disable accounts and grant Adult access one account at a time. Adult content remains hidden unless both the instance master switch and that account's grant are on. The age prompt is self-attested, not identity or legal age verification.

Configure metadata providers and shared media services in Admin settings. Service URLs and credentials are encrypted in PostgreSQL using `INTEGRATION_CREDENTIALS_KEY`. Only enable private-network targets for an instance whose accounts and administrators you trust.

## Upgrades and recovery

For Compose, back up PostgreSQL and the deployment secrets before pulling or checking out the desired release, then rerun the Compose command above. For LXC, the in-container `update` command downloads a PostgreSQL dump to `/var/backups/choice-fatigue/` before updating the app and retains the three newest dumps. Back up `/opt/choice-fatigue/.env` separately and copy database dumps off the container. The v1 cleanup migration drops the unused `CatalogueEntry` table and deletes the obsolete TVDB credential row. It does not affect account choices, saved provider IDs, or integrations; retain an off-container backup before upgrading or restoring.

To recover first-admin access, use the documented `pnpm admin:promote -- account-email@example.com` command from a trusted shell in the app environment. Do not recreate the database or regenerate the encryption key as an account-recovery step.
