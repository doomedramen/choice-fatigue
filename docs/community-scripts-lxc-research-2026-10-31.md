# Proxmox Community Scripts integration research

**Reviewed:** 2026-10-31 against the official Community Scripts GitHub repositories and contribution documentation.

## What the project means by a Community Script

Community Scripts is a shared installer engine plus application-specific scripts. Its current ProxmoxVE README says an application script describes what to install, while the shared `core` engine handles container creation, prompts, errors, and platform behavior. The same application CT script can target Proxmox VE and Incus. The supported host command is a one-line invocation from the script page; it runs as root on the Proxmox host. [ProxmoxVE README](https://github.com/community-scripts/ProxmoxVE), [core README](https://github.com/community-scripts/core/blob/main/README.md)

New applications are developed and tested in [DevScripts](https://github.com/community-scripts/DevScripts), not added directly to ProxmoxVE. The official contribution guide calls for a pair of scripts: `ct/<app>.sh` for container creation, variables, and update handling; and `install/<app>-install.sh` for installing the application inside the newly created container. DevScripts asks that the script be tested on a real Proxmox instance and receives test feedback before maintainers promote it. [ProxmoxVE contribution guide](https://github.com/community-scripts/ProxmoxVE/blob/main/CONTRIBUTING.md), [DevScripts README](https://github.com/community-scripts/DevScripts)

The site also consumes a per-app metadata record under `json/<app>.json`, including supported platform, CPU/RAM/disk/OS defaults, interface port, documentation and source URLs, architecture support, updateability, and notes. Website-managed presentation metadata (name, description, logo, tags) is handled through the site, not committed as a repo-side metadata change. [DevScripts guidance](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md), [ProxmoxVE contribution guide](https://github.com/community-scripts/ProxmoxVE/blob/main/CONTRIBUTING.md)

## Installation and update expectations

The CT script loads the shared `core` build engine; it should not contain its own `pct create` workflow. The engine creates the container and passes its shared install functions to `install/<app>-install.sh`, which then sets up the app inside the guest. The upstream CT template shows the engine-loading pattern and the expected `header_info`, `variables`, `catch_errors`, `start`, `build_container`, `description`, and `update_script()` flow. [DevScripts guidance and templates](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md), [core README](https://github.com/community-scripts/core/blob/main/README.md)

The install script sources the engine-provided `FUNCTIONS_FILE_PATH` and uses its setup helpers. Current DevScripts guidance requires application CT scripts to be bare-metal installs: do not wrap the app in Docker Compose. It also requires using existing helpers rather than implementing duplicate setup logic, and limits app scripts to the documented structure (the CT's `update_script()` is the one application-defined function). [DevScripts guidance](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md)

An updateable app needs a working `update_script()` in the CT script, since the project documents an in-container `update` command. App settings that can be supplied unattended must use exported `var_*` values, be read before prompting, and be declared as `app_vars` in JSON metadata; credential-like values must be marked secret. [DevScripts guidance](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md), [ProxmoxVE contribution guide](https://github.com/community-scripts/ProxmoxVE/blob/main/CONTRIBUTING.md)

## Review findings before the installer change

Before this review's implementation, `scripts/install-lxc.sh` was a standalone installer intended to run as root from a checked-out repository inside a Debian 13 container. It installed PostgreSQL and Node, prepared the repository, built the Next.js app, and created a systemd service itself. That did not follow Community Scripts: it assumed the LXC already existed and repeated container provisioning that the shared engine owns.

## Implementation follow-up

The repository is now public. The installer follows the Community Scripts paths: [`ct/choicefatigue.sh`](../ct/choicefatigue.sh), [`install/choicefatigue-install.sh`](../install/choicefatigue-install.sh), and [`json/choicefatigue.json`](../json/choicefatigue.json). The Proxmox command runs the CT script directly; its `_CS_DEFAULT_URL` points to this repository so the engine can fetch the matching installer and updater. The CT script delegates container creation to the shared engine; the app installer uses engine helpers for the Debian update, PostgreSQL 17 database, and Node.js 22 setup.

There are no GitHub releases or tags yet, so installation and in-container updates track public `main` through the engine's branch deployment and update helpers. Switch to the release helper once the project publishes a release. The app pair has not been tested on a real Proxmox host and has not been submitted to DevScripts; Community Scripts guidance requires that real-host test before promotion. No app license is declared in the repository, so settle the license before an upstream catalog submission.

Choice Fatigue is a Node + PostgreSQL app. The app installer uses the engine's PostgreSQL and Node helpers; its app-specific work builds the Next.js project, applies Prisma migrations, writes the auth/encryption environment file, and creates the systemd service.

## Uncertainties to resolve during implementation

- The public contribution guide links to the detailed `community-scripts.org/docs/contribution` page, but that documentation endpoint was inaccessible to this review tool. The current official DevScripts `AGENTS.md` and repository README were accessible and provide the relevant script contract; re-check the linked docs when implementing.
- Community Scripts' README advertises “one-command installations” and DevScripts lists CT scripts as targeting Proxmox VE and Incus. The metadata schema can specify platforms, and the current ProxmoxVE docs say application scripts are picked up by Incus. Do not claim Incus compatibility for this app until its installer is tested there.
- The Community Scripts template and rules evolve. Pin the expected engine loading/helper API to the current official docs and test against a real supported host before proposing the scripts upstream.

## Primary sources

- [ProxmoxVE README](https://github.com/community-scripts/ProxmoxVE)
- [ProxmoxVE contribution guide](https://github.com/community-scripts/ProxmoxVE/blob/main/CONTRIBUTING.md)
- [DevScripts README](https://github.com/community-scripts/DevScripts)
- [DevScripts current contribution guidance and templates](https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md)
- [Community Scripts core README](https://github.com/community-scripts/core/blob/main/README.md)
- [Community Scripts core contribution map](https://github.com/community-scripts/core/blob/main/CONTRIBUTING.md)
