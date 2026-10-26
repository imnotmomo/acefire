# GitHub Actions deployment

`CI` runs on pull requests, pushes to `main`, and manual dispatches. It installs
the locked dependencies and real Office/OCR tools, runs backend, frontend, PDF,
Roundtable and deployment tests, and builds a checksummed release artifact.
PR tests have no production credentials and do not call the live providers.

After both CI jobs pass, a trusted `main` run calls `deploy.yml`. Automatic
deployment is enabled only when the repository variable `HOME_CD_ENABLED` is
`true`. Keep it false until the host bootstrap, secrets and SSH checks pass.
The workflow can be run manually against `main` to retry a failed deployment.

## Credentials

These are encrypted **repository Actions secrets**, never committed files:

| Secret | Use |
| --- | --- |
| `ACEFIRE_DEPLOY_SSH_KEY` | Dedicated Ed25519 private key for `ingenium-deploy` |
| `ACEFIRE_DEPLOY_KNOWN_HOSTS` | Previously verified SSH host key; no first-use acceptance |
| `NICRRON_API_KEY` | Existing C and B model calls |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Dedicated home identity, limited to the existing named database |
| `PRISMTRACE_API_KEY` | Existing PRISM instrumentation |
| `PRISMTRACE_HOST` | Existing instrumentation endpoint |
| `PRISMTRACE_PROJECT_ID` | Existing instrumentation project |

Akta currently uses cached company responses. No active Akta credential was found
in the configured production runtime; do not invent one or claim live retrieval
works. If configured later, store its credential as an Actions secret and add an
explicit runtime mapping. Provider setup is separate from database migration.

Use `gh secret set NAME --repo imnotmomo/acefire` with the value on **stdin**,
not a command argument. Listing secret names verifies configuration without
revealing their values. GitHub's connected code tool does not administer Actions
secrets; the operator needs an authorized CLI session or appropriately scoped
repository credential for this step. Never upload a personal Google refresh
token, a sudo password or a Cloudflare administrator token.

The Cloudflare SSH route currently needs no Access service token. Its transport
was checked using an empty client configuration. The runner uses the pinned
official `cloudflared` binary over HTTPS and normal SSH public-key authentication.

Latest-main verification uses the deployment job's built-in, short-lived
`github.token` with `contents: read`. It travels only in the private SSH bundle
and stays in the controller's memory, outside application artifacts, runtime
files, rollback snapshots, state and logs. This avoids the anonymous GitHub API
quota shared by the VM's WARP exit IP. No additional stored GitHub credential is
required. Missing or rejected tokens fail before activation with a sanitized
diagnostic; the controller never falls back to anonymous requests or follows
API redirects.

## One-time host bootstrap

Generate a dedicated key outside the repository. Transfer only its `.pub` file
and the reviewed host-side source to the VM, then run as root:

```bash
bash install-cd.sh /private/path/deploy_ed25519.pub /private/path/reviewed-home-vm-source
```

The installer creates `ingenium-deploy`, protects its public `authorized_keys`
against modification, and grants no ordinary shell, SCP/SFTP, forwarding or PTY
access through this key. Its forced gateway accepts only `status` and
`deploy <40-character SHA>`. The narrow sudo rule invokes a fixed root-owned
controller; it never evaluates arbitrary SSH command text.

Test `status` with the new key, the pinned `known_hosts` file and the existing
Cloudflare SSH hostname. A command such as `id` must be rejected. Preserve the
owner's separate administrative SSH identity.

The installed gateway/controller live under `/usr/local/libexec/`; their update
requires a reviewed administrative bootstrap. A release cannot replace privileged
scripts, systemd units, Nginx or tunnel configuration by supplying them in its
artifact.

Install a protocol-changing controller update before dispatching its matching
workflow. Older workflow revisions without the job-token bundle member must be
replaced by a new run of current `main`, rather than rerun unchanged.

## Release behavior

1. The frontend job packages the exact committed source and tested build.
   Local environments, credentials, caches, source-data fixtures and historical
   archives are excluded. The deployed originals already live outside releases.
2. The deployment job receives that artifact from the **same workflow run**,
   creates private runtime files from secrets and sends a bounded USTAR stream
   through restricted SSH. Private runner files are removed even on failure.
3. The server locks activation, checks archive paths/types/size/hashes, exact
   commit, current `main` head and monotonic workflow number. Superseded builds
   cannot publish over a newer one.
4. Python dependencies are installed as `ingenium` in a fresh Linux virtual
   environment. Application files are then frozen read-only to that user.
5. The controller saves the current links and runtime configuration, stops the
   backend, switches application/static links atomically and restarts it.
6. Health, release identity, HTML and JavaScript/CSS hashes must pass through
   the public tunnel. Failure restores the previous links and runtime files and
   restarts the previous service. Fault-injection tests exercise this rollback.

Application releases are `/srv/ingenium/releases/ci-*`; static copies are under
`/var/www/ingenium/releases/`. The controller keeps three recent CI releases
plus the active/previous releases; the original manual deployment is retained.
Private activation logs and runtime rollback snapshots are under
`/var/lib/ingenium-cd/`, mode `0700`.

The existing PRISM drop-in, English presentation manifest, registered source
files, uploads, job receipts, Firebase records, database edition and billing are
preserved. Hosting changes do not restore or recreate Firestore. Browser drafts
remain attached to `ingenium.linearproduct.co`; use that origin to retain them.

## Operations

Disable automatic deployment without disabling CI:

```bash
gh variable set HOME_CD_ENABLED --body false --repo imnotmomo/acefire
```

Review the private deployment log for failed activations. Do not paste runtime
files into issues or Actions logs. A GitHub deployment is complete only after its
job and public release checks pass; a pushed commit or green unit tests alone do
not establish which release the server is running.
