# Acefire home VM deployment

These helpers provision the existing `acefire` ESXi VM and attach Ingenium to its existing Cloudflare Tunnel origin. They do not provision a new network, tunnel, Firebase project or database. They are first-provisioning and operator-controlled cutover helpers, not a general release updater.

## Recorded state — October 24, 2026, New York

| Component | Verified state at this handoff |
| --- | --- |
| Home application | Healthy through backend loopback `127.0.0.1:8017` and Nginx loopback `127.0.0.1:8080` |
| Home public hostname | `acefire.linearproduct.co` returns the intended home release, matching HTML/JavaScript hashes and healthy Firestore API |
| Edge remedy | The human added the Browser Integrity Check exception restricted to the two web hostnames; public home readback passed afterward |
| Existing production | The old VPS backend is stopped/disabled. Its temporary Caddy bridge served the verified home release before the DNS update |
| DNS | `ingenium.linearproduct.co` now has a proxied CNAME to the existing tunnel; public resolvers and the local resolver confirm the new route, and its public health check passes |
| Firebase | Existing project `acefire-50248`, named database `acefire`, Standard/native, `us-east1`, `freeTier: true`, billing disabled |
| Home validation | 423 backend tests and 93 frontend tests passed; both company reports, 16 original-file SHA-256 checks, two saved Enfuce drafts / 24 sections / 128 citations and three calculation lineages passed the internal application audit |

This is a point-in-time handoff. Refresh the status and active release before acting. Healthy loopback responses do not prove that Cloudflare permits public traffic. A 403/1010 response is a failed public acceptance check, not a successful deployment.

## Release provenance

- Home release: `20261025T014948Z-home-6ff0a06c537f`.
- Backend/application base: `97658f4fef0a3ac6bd214b3ae95f2851d2afba21`.
- Approved frontend: the prior layout and functionality plus the human-approved logo/favicon overlay, recorded as `acefire-logo-only`; approved source release `20261024T203754Z-6ff0a06c537f`.
- Approved main frontend asset: `index-18_WVVs7.js`.
- Approved `index.html` SHA-256: `fe5c799a1a16e75d7a1056f6c130263599b0574582c547af53d85f06ce52df84`.
- The supplied distribution manifest covers 29 files. All files must match before deployment metadata is rewritten. The 28 non-metadata frontend files remain exact; only `release.json` gains the home target, transport, backend commit and deployment time.

The checked-out Git `main` can contain newer teammate UI work. Do not silently substitute it for this approved frontend. Preparation builds and tests the supplied source, then publishes the separately hash-verified approved distribution. Inspect `/release.json` and actual served artifact hashes when identifying a running release.

## Host and service layout

SSH uses the existing `acefire` alias, the existing `id_ecdsa` identity and Cloudflare Access transport. The SSH tunnel hostname is `ssh-acefire.linearproduct.co`; preserve its `ssh://127.0.0.1:22` ingress rule. Keys, Access sessions and sudo credentials stay outside the repository. The VM remains in its existing VLAN 130 / WARP isolation; these scripts must not reconfigure ESXi networking, the separate Cloudflare VM, VLAN policy or WARP routing.

| Path or service | Purpose |
| --- | --- |
| `/srv/ingenium/releases/<release-id>` | Editable application source and dedicated backend virtual environment |
| `/srv/ingenium/current` | Active backend source link |
| `/var/www/ingenium/releases/<release-id>` | Public frontend files only |
| `/var/www/ingenium/current` | Active public distribution link |
| `ingenium-backend.service` | Unprivileged `ingenium` process on `127.0.0.1:8017` |
| `/etc/systemd/system/ingenium-backend.service.d/` | Preserved PRISM drop-in and home resource limits |
| `/etc/nginx/sites-available/ingenium` | Project Nginx configuration |
| `/etc/nginx/sites-enabled/acefire-status` | Existing enabled-site name, changed to the project configuration only during activation |
| `/etc/cloudflared/config.yml` | Existing tunnel routing; contains private configuration and is never published |
| `/root/ingenium-home-deploy-backups/<release-id>` | Private deployment baseline, imported state, logs and tunnel rollback artifacts |

Nginx serves the frontend on loopback port 8080 and proxies `/api/` to the backend on loopback port 8017. Cloudflare Tunnel supplies the public HTTPS entry point. Source uploads allow a 53 MiB proxy body, with the backend's own 50 MiB file limit. Hashed assets are immutable; HTML and deployment metadata are revalidated. The home service retains the existing backend isolation, adds a 1400 MiB memory limit and sets `OMP_NUM_THREADS=1`.

The app continues using Firebase Standard. There is no local replacement Firestore database and no database migration, billing activation, Cloud Functions deployment or Storage bucket creation in this home deployment.

## Private staging

The operator supplies a private staging directory; its exact local path is recorded privately under `~/.codex/acefire-home-deployment`. Do not place these inputs in the Git checkout or public web root. Transfer to a root-owned directory with mode `0700`; private files stay `0600`, or `0640 root:ingenium` where the service must read them.

Initial staged inputs include:

- `artifact-manifest.json` with SHA-256 values for every supplied archive.
- `application-base-97658f4.tar.gz`.
- `frontend-approved-source.tar.gz`, `frontend-approved-dist.tar.gz` and `frontend-approved-manifest.json`.
- `private-runtime-and-evidence.tar.gz`, containing the existing runtime configuration, original source files, upload bytes/job receipts, source manifest, English presentation manifest and PRISM assets.
- `home-firestore-runtime.json`: a dedicated authorized runtime identity; never a personal ADC credential.

Activation additionally requires `cutover-manifest.json`, `final-private-state.tar.gz`, `application-baseline.tar.gz` and the reviewed `nginx.conf`. The cutover manifest must contain exactly the two final archives and match their hashes. The final state must come from a fresh capture after writers are paused, not an earlier staging copy.

Runtime private paths include `/etc/ingenium/backend.env`, `/etc/ingenium/firestore-runtime.json`, the source/English manifests, `/etc/ingenium/prism.env`, `/opt/ingenium-prism`, and `/var/lib/ingenium/{sources,uploads}`. Preserve the existing paths used by the application. Do not include their contents, model keys, credential JSON, passwords or private-key bytes in Git, reports or command output.

## Provision and prepare

Run through an authorized SSH session and root shell, from a checkout or staging root containing the reviewed `deploy/home-vm` helpers. The deployed application base predates these helper files, so transfer them separately rather than assuming they already exist in its release tree. The scripts assume the existing Nginx status site and working `cloudflared` service are already present. `provision-host.sh` adds the project user, private directories, Python/Office/OCR dependencies and pinned Node.js `24.22.1` for Linux x64. Node's downloaded archive is checked against the vendor checksum.

Preparation is intentionally blocked when either application `current` target exists. A failed or partially completed first provision requires inspection; do not remove its directories or links just to force a retry. For an established installation, use a new, separately reviewed update procedure with explicit before/after links and rollback, rather than rerunning this first-provisioning helper.

```bash
set -euo pipefail
release_id=20261025T014948Z-home-6ff0a06c537f
: "${STAGING:?Set STAGING to the private, verified staging directory}"

bash deploy/home-vm/provision-host.sh
bash deploy/home-vm/prepare-release.sh "$release_id" "$STAGING"
```

Preparation verifies archives, installs private state, runs dependency checks and tests, verifies every approved distribution file, pins backend/public links and restarts the service. It does not change Nginx's active site, the tunnel ingress or DNS. Its service startup must return healthy before continuing. The prepare, activation and tunnel-alias helpers share `/run/ingenium-home-deploy.lock` and reject another active helper.

## Public cutover gates

Do not stop the working VPS while the home hostname is blocked by Cloudflare. Resolve and verify the narrowly scoped edge policy first. The approved exception is restricted to the web hostnames `acefire.linearproduct.co` and `ingenium.linearproduct.co`; it must not change the SSH Access application or disable security controls zone-wide.

Once the home web hostname is demonstrably reachable, perform the final cutover in this order:

1. Record both hosts' active links, service state, Nginx/Caddy/tunnel configuration and the current application DNS record. Keep the previous VPS release and rollback files.
2. Pause application writes and imports for the final private-state capture. Avoid two public backends accepting uploads into different local caches. Retain the existing shared Firestore database unchanged.
3. Capture, transfer and hash-check final originals, uploads/jobs, manifests, runtime state and application baseline. Preserve any home-side data accepted during staging; do not use destructive `rsync --delete`.
4. Run `activate-home.sh` only against the prepared release and matching final staging. It stops the home backend, installs final state, starts it, requires backend health, validates Nginx, reloads it, then waits for the intended release, exact index hash and named-Firestore API health on loopback port 8080.
5. Run the independent read-only application/source audit against the final baseline: logical company reports and record IDs, all available original-file hashes, expected missing-file responses, stored report citations and calculation lineage. Keep saved report IDs and source locators intact.
6. Verify the same application release and assets through public `acefire.linearproduct.co`. Only then stage the extra `ingenium.linearproduct.co` tunnel alias and later change that hostname's DNS route.
7. Recheck public health, release metadata, HTML and hashed assets on both intended hostnames. Reopen writers only after the final target is verified; keep the previous origin's API in maintenance during stale-DNS propagation so uploads cannot split between hosts.

Every step is a gate. If a command or health/audit check fails, stop the cutover, preserve its logs and restore the previously working origin. Do not append an unconditional DNS update, origin shutdown or success message after a failed command. Use `set -euo pipefail`, including when logging through `tee`.

```bash
set -euo pipefail
bash deploy/home-vm/activate-home.sh "$release_id" "$STAGING"
# Continue only after that command exits zero AND the independent audit passes.
```

Nginx reload is asynchronous. A single immediate response can still come from old workers. The activation helper retries the **expected release ID**, exact index SHA and API health instead of treating one response or `/healthz` alone as readiness. If the bounded check fails, public traffic stays on the previous host.

## Tunnel alias and confirmation

`stage-tunnel-alias.sh` compares the current tunnel configuration with its saved baseline, builds and validates a candidate and confirms both web routes still use `http://127.0.0.1:8080`. It leaves the SSH route intact. The helper schedules a detached tunnel restart and a 120-second automatic rollback unless the operator confirms the candidate.

```bash
set -euo pipefail
bash deploy/home-vm/stage-tunnel-alias.sh "$release_id"
```

After the restart, establish a **new** `ssh acefire` session and verify the tunnel ingress and public application from that session. Only after these checks pass should the operator create `/root/ingenium-home-deploy-backups/<release-id>/tunnel-confirmed`. A failed public check, including 403/1010, is not confirmation. The rollback script compares the current configuration with the staged candidate before restoring its baseline, so it refuses to overwrite a newer operator change. Inspect both transient systemd units and the marker state before retrying.

The helper adds an ingress alias; it does not alter DNS. DNS cutover is a separate, last-step operation using the recorded baseline and the existing authorized Cloudflare configuration.

Keeping `ingenium.linearproduct.co` as the application origin preserves that origin's browser drafts, revisions and IndexedDB files. Opening the separate `acefire.linearproduct.co` origin uses separate browser storage; the deployment does not silently copy browser-local drafts or files between origins.

## Rollback and later updates

Before DNS changes, failure recovery is to keep or restore the original VPS application at `159.89.53.226` and leave DNS unchanged. A healthy home loopback does not justify shutting down that fallback while the edge still rejects requests.

For home routing rollback, restore the saved `nginx-status.before` and the exact enabled-site symlink mapping from `nginx-enabled.before`, validate Nginx and wait for the restored response after reload. Do not replace unrelated enabled sites. Restore the tunnel baseline through the guarded rollback helper, retaining a working SSH route and its reconnect/rollback timer protections.

If DNS has already moved, first confirm that the previous origin is ready, then restore the recorded DNS route. If the home host accepted new uploads, preserve and reconcile those originals/jobs/manifests before reopening writes on the VPS. Firestore is shared: do not restore an older cloud snapshot or recreate its database as part of application-host rollback.

These scripts do not provide an automatic full application rollback transaction. If a step fails after changing service/configuration files, inspect the private baseline and journal before restarting or retrying. Cloudflare currently imposes its own proxy read timeout; increasing the Nginx timeout does not extend it. Keep upload extraction asynchronous, and verify real model requests through the public hostname after updates.

A future application update must stage a new immutable release, save current service/configuration/link state, switch links atomically, explicitly restart the backend, wait for semantic health and matching public artifacts, and retain a tested rollback path.

Known unavailable inputs remain explicit: the original Enfuce PDF has not been supplied, so its saved quotations remain traceable while file opening stays unavailable. Live Akta retrieval remains separate from this deployment. Login is still deferred. The home provisioning checks did not use a browser. A separate public synthetic workflow passed 15 live checks: company creation/retry, text and exact-decimal CSV intake, duplicate upload reuse, model PDF extraction, OCR/image extraction, a 2.15 MB multipart upload, original-file hashes, generated Python and its CSV-row lineage, both live chat modes, cited report drafting and unchanged release metadata. The Decimal result was `300.580000` for two source months, without annualization. All 17 synthetic database records were backed up and removed afterward. Calculation, company chat, source chat and drafting took about 11, 3, 4 and 11 seconds respectively, within the Cloudflare edge timeout in this run; this does not guarantee every future model request finishes within that limit.
