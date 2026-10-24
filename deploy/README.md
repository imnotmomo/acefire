# Ingenium VPS deployment

Target: `ingenium.linearproduct.co` / `159.89.53.226`, Ubuntu 24.04.
SSH uses the human's existing root key. The web/API processes run as their
separate `caddy` and `ingenium` system users.

## Runtime layout

| Path | Purpose |
| --- | --- |
| `/srv/ingenium/app` | Git checkout, owned by ingenium |
| `/srv/ingenium/releases/{release_id}` | Isolated application source, Python venv and frontend build |
| `/srv/ingenium/current` | Active backend release symlink |
| `/var/www/ingenium/releases/{release_id}` | Root-owned copy of public frontend artifacts only |
| `/var/www/ingenium/current` | Active public static release symlink |
| `/etc/ingenium/backend.env` | Root-only model/runtime environment |
| `/etc/ingenium/firestore-runtime.json` | Root-owned, ingenium-readable runtime identity |
| `/etc/ingenium/source-files.json` | Private snapshot-to-file manifest |
| `/var/lib/ingenium/sources` | Original Circle evidence, outside the public web root |
| `/var/lib/ingenium/uploads` | Writable private originals, extraction artifacts, source index and durable jobs |
| `/etc/ingenium/english-translations.json` | Content-bound English presentation of immutable imported reports |
| `/root/ingenium-deploy-backups/{release_id}` | Prior links/configuration and executable rollback |

The dedicated Google service account is
`ingenium-vps@acefire-50248.iam.gserviceaccount.com`. Its `roles/datastore.user`
binding has the condition
`resource.name == "projects/acefire-50248/databases/acefire"`.
The VPS does not use the developer's personal Google refresh credential.
No Firebase billing or database configuration is changed by this deployment.

The API binds only to `127.0.0.1:8017`. Caddy retains existing TLS and redirects,
serves the compiled frontend, and proxies `/api/*` with the `/api` prefix removed.
The systemd service starts on boot, restarts on failure, and runs with a read-only
filesystem view, private temporary directory, no privilege escalation, and resource
limits. The generated Python worker retains its application-level restrictions;
this is not a hardware sandbox.

Login remains deferred by the human. New company workspaces and uploads now use
Firestore and B’s existing source validation pipeline. The unit permits writes only
to `/var/lib/ingenium/uploads` in addition to its private temporary directory; Caddy
allows 53 MB request bodies for the backend’s 50 MiB file limit. CSV/Excel/native
text, PDFs, Office and OCR images feed stored evidence, calculations, reports and
both chat modes. Model requests are live provider calls. Source-file search uses
`/evidence-chat`; whole-company chat retains `/chat`. Roundtable stays disabled.
Original Enfuce PDF bytes were not supplied; quotations/page references remain
available, while original-file preview is marked unavailable. Circle's 16 available
source files are copied privately and checked against their registered SHA-256.

## Prepare and activate a release

The Linux build/test machine needs LibreOffice for B's real DOCX/PPTX conversion
checks (`soffice`/`libreoffice` on PATH, or `SOFFICE_BIN`). Python dependencies alone
do not supply it. An earlier stage correctly stopped when the converter was absent.
It is now installed. Image/scanned-PDF intake also requires Tesseract and its English/
Chinese language data. The service selects `eng+chi_sim+chi_tra`; no source macro or
spreadsheet formula is executed. Retain the private English translation manifest
and existing PRISM systemd environment drop-in across releases.

Do not put credentials in source, shell command arguments, build artifacts or logs.
Install the private backend environment using `backend.env.example` as a template,
and ADC/source manifest files under `/etc/ingenium` with the permissions above.

1. Confirm the server checkout is clean. As `ingenium`, fetch/pull GitHub with
   `--ff-only`; do not reset teammate changes.
2. Copy the two release scripts, Caddyfile and unit into
   `/root/ingenium-deploy-staging/` over SSH.
3. Run `prepare-release.sh RELEASE_ID FULL_COMMIT_SHA`. It archives the precise
   revision, creates an isolated Linux venv, installs `backend/requirements.lock`, freezes resolved
   Python versions, builds the locked frontend, runs backend/frontend tests and
   prepares the public static copy. It leaves the active release unchanged.
4. Record `readlink -f /srv/ingenium/current`, then run
   `activate-release.sh RELEASE_ID EXPECTED_PREVIOUS_APP_PATH`. Activation takes a
   server lock and refuses if the active backend changed after preparation. It
   installs the unit/Caddyfile from the precise prepared release, preserving
   existing systemd drop-ins. It snapshots current links/configuration,
   installs the service, checks Firestore health and the imported Enfuce report,
   validates/reloads Caddy, atomically switches the public symlink and checks live
   HTTPS metadata. Failed activation invokes its saved rollback.
5. Independently verify public release metadata, HTML/asset hashes, report sources,
   saved-report loading, model chat and a generated calculation. Local success
   does not prove the published release.

`release.json` in the public build records the exact source commit and release ID.
Dependency/build/test logs are `/var/log/ingenium-{python,npm,build,tests}-RELEASE_ID.log`.
The server's resolved Python requirements are saved in the release, rather than
copying a macOS virtual environment to Linux.

## Operations

```bash
systemctl status ingenium-backend caddy
journalctl -u ingenium-backend -n 60 --no-pager
curl -f https://ingenium.linearproduct.co/api/health
curl -f https://ingenium.linearproduct.co/release.json
```

To roll back, run the specific release's
`/root/ingenium-deploy-backups/RELEASE_ID/rollback.sh`. It restores the prior
frontend/backend symlinks, Caddy configuration and prior service state. Credentials
and Firestore data are not rewritten by application rollback. Old releases are
retained until a human decides they are no longer needed.

Credential rotation: create a replacement runtime key, privately install it with
owner/group permissions, restart and verify the service, then revoke the retired
key. Never change organizational key policies to bypass a denied operation.

References: [Firestore database IAM conditions](https://firebase.google.com/docs/firestore/manage-databases),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Google service account keys](https://docs.cloud.google.com/iam/docs/keys-create-delete).

## Verified workflow release —2026-10-24

Active application commit:e7b3d2d; release20261024T200013Z-e7b3d2df5e41.
Server passed423 backend and86 frontendunit/SSRtests, productionbuild,21 live API/artifactchecks and15 live synthetic-company workflowchecks (real model/PDF/OCR/calculation/chat/draft). Login remains deferred. Synthetic cloud fixtures were backed up and cleaned; source-company records were not changed. Browser access was declined in the deployment chat, so no new browser click-through is claimed.
