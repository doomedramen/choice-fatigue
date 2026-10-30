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

Create an unprivileged Debian 13 container with at least 2 CPU cores, 4 GB memory, and persistent root storage. Configure its bridge and address in Proxmox, then start it. From the Proxmox host, a typical provisioning sequence is:

```sh
pveam update
pveam available --section system | grep debian-13-standard
pveam download local <debian-13-template-name>
pct create <CTID> local:vztmpl/<debian-13-template-name> --hostname choice-fatigue --cores 2 --memory 4096 --swap 2048 --rootfs <storage>:16 --net0 name=eth0,bridge=<bridge>,ip=dhcp,ip6=auto --unprivileged 1 --onboot 1
pct start <CTID>
pct enter <CTID>
```

Inside the container, install Git, clone the project checkout, and run the installer from its root directory as root:

```sh
apt-get update && apt-get install -y git
git clone <your-project-repository> /opt/choice-fatigue
cd /opt/choice-fatigue
./scripts/install-lxc.sh https://choice.example.com
```

The installer installs Node.js 22+, pnpm 12.16.1, and PostgreSQL; generates database, auth, and credential-encryption secrets; applies migrations; builds the app; and creates the `choice-fatigue` systemd service on port 4173. It refuses to overwrite an existing `.env` or service. Keep the project checkout and database on persistent LXC storage.

Configure a trusted reverse proxy to the LXC address on port 4173. Set the installer URL to the browser-facing HTTPS address so authentication cookies use the correct origin. Check the service with `systemctl status choice-fatigue` and `curl http://127.0.0.1:4173/api/health`; use `journalctl -u choice-fatigue` for logs.

## First-run setup and access

Open the public URL and register the first account; it becomes the administrator. In Admin settings, set a reusable invite code and share it manually with people who may register. There is no email invitation flow. Admins can disable accounts and grant Adult access one account at a time. Adult content remains hidden unless both the instance master switch and that account's grant are on. The age prompt is self-attested, not identity or legal age verification.

Configure metadata providers and shared media services in Admin settings. Service URLs and credentials are encrypted in PostgreSQL using `INTEGRATION_CREDENTIALS_KEY`. Only enable private-network targets for an instance whose accounts and administrators you trust.

## Upgrades and recovery

For Compose, pull or check out the desired release and rerun the Compose command above. For LXC, back up PostgreSQL and `.env`, update the checkout to the desired release, then run `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, and `pnpm db:deploy` as the `choicefatigue` user; restart with `systemctl restart choice-fatigue`.

To recover first-admin access, use the documented `pnpm admin:promote -- account-email@example.com` command from a trusted shell in the app environment. Do not recreate the database or regenerate the encryption key as an account-recovery step.
