# QA staging and promotion

| Environment | Source | Workflow | Public website | Storage |
| --- | --- | --- | --- | --- |
| QA | `qa` | `qa.yml` / QA CI/CD | https://qa.linearproduct.co | Private QA DuckDB and copied originals |
| Production | protected `main` | `ci.yml` / CI | https://ingenium.linearproduct.co (alias https://acefire.linearproduct.co) | Existing named Standard Firestore |

## Required agent workflow

Every change, including documentation and infrastructure, starts on a new feature branch from current `qa`. Preserve existing work; fetch and inspect before switching branches. Push the feature branch and open a PR to `qa`. PR checks run offline and do not deploy.

After those checks pass, merge into `qa`. Wait for **QA CI/CD** to finish deployment, then verify the exact deployed commit and test the affected workflows on the QA website. A passing PR check or a successful upload of an artifact is not a deployed test. If QA advances while testing, inspect the additional changes, wait for the new deployment, and test that version before promoting it.

When deployed QA works, the agent opens a `qa` → `main` PR with a short description of the change, tested commit/run and validation. Enable auto-merge (`gh pr merge <number> --auto --merge --repo imnotmomo/acefire`) under the human's standing authorization. Respect required checks and review rules; never use `--admin`, force-push or bypass branch protection. If a required condition prevents auto-merge, report the PR and the concrete blocker.

Merging into `main` starts the existing production CI/CD pipeline. Wait for publication and verify both production hostnames. Code promotion never copies QA data into production. The authoritative agent policy is [AGENTS.md](../../AGENTS.md).

## Verify and retry

Track the exact full commit SHA:

```bash
gh run list --repo imnotmomo/acefire --workflow qa.yml --commit <full-SHA>
gh run view <run-id> --repo imnotmomo/acefire
gh run view <run-id> --repo imnotmomo/acefire --log-failed
```

Use `ci.yml` for production runs. Both workflows call the secret-free `checks.yml` for backend tests, frontend tests/build and a checksummed artifact. Each deploys the artifact from its own run. Production and QA have separate non-cancelling deployment queues. `QA_CD_ENABLED` and `HOME_CD_ENABLED` independently gate publication; PRs and ordinary feature-branch pushes cannot activate a release.

QA `/api/health` must return `status: ok` and `storage: duckdb`. Its `/release.json` must identify `environment: qa`, `branch: qa`, the intended `commit` and `backend_commit`, and the correct workflow run. Confirm served frontend hashes against that artifact. For production, check both public origins, the expected commit/run, and `storage: firestore`, project `acefire-50248`, database `acefire`.

A superseded-branch diagnostic means an older build was safely refused. Follow the newest branch run; do not disable the guard or cancel an activating deployment. After diagnosing a genuine failure, retry current QA with `gh workflow run qa.yml --ref qa --repo imnotmomo/acefire`; use `ci.yml --ref main` for production. The short-lived workflow token authenticates branch checks; never replace it with anonymous API calls or put it in runtime files/logs.

## Isolation and credentials

QA runs as `ingenium-qa` in `ingenium-qa-backend.service`, on loopback backend `8018` and Nginx `8081`. Its code and static releases are under `/srv/ingenium-qa` and `/var/www/ingenium-qa`; private configuration is `/etc/ingenium-qa`; DuckDB, uploads and copied source bytes are under `/var/lib/ingenium-qa`. There is one backend worker per DuckDB file. Release state and private rollback logs are `/var/lib/ingenium-qa-cd`. Production retains its original paths and service.

QA uses a separate `ACEFIRE_QA_DEPLOY_SSH_KEY` and forced SSH account `ingenium-qa-deploy`. That account can only request QA status or an exact-SHA QA deployment. Its sudo rule cannot invoke the production controller. Both targets retain pinned host keys, bounded archive verification, immutable application releases, public readiness checks and rollback.

QA receives its model credential and the ephemeral read-only GitHub token. It receives no Firestore service account or production PRISM configuration. Its backend environment is restricted to fixed QA paths and DuckDB; the service cannot read production private directories. Model calls on QA use the configured provider and its normal usage limits. Keep credentials private.

QA begins from a verified offline snapshot, independently copied originals, and the separate English presentation manifest. It is not a live replica of production. The missing Enfuce original stays missing. QA edits, uploads and jobs persist across QA code deployments; never reseed automatically, connect QA to production Firestore, or copy test data back to production. This staging setup does not create a billable cloud database or change Firebase billing.

## Administrative bootstrap

Review and transfer the host-side files plus only the QA public key and an approved offline snapshot into a private staging directory. From root on the existing host:

```bash
bash provision-qa.sh /private/reviewed-source /private/qa.pub /private/documents.jsonl
bash stage-qa-tunnel.sh
```

`provision-qa.sh` prepares an initial rollback release, isolated data/service and restricted deployment identity. It reads production's existing source manifest/originals and model configuration once to create separate QA copies, without changing them. Seeding validates snapshot envelopes and original hashes and refuses an existing QA database. Do not rerun bootstrap to repair an existing environment; diagnose its failed stage and preserve state.

Create the proxied `qa.linearproduct.co` DNS record for the existing tunnel. The tunnel script adds only QA ingress and schedules automatic rollback after 180 seconds. After public QA and both production hosts are healthy and a fresh SSH connection succeeds, compare the candidate config with the active config and create `/var/lib/ingenium-qa-cd/tunnel-bootstrap/confirmed`. It never changes WARP, VLAN or ESXi configuration. Preserve the prior tunnel config for rollback.

Later privileged controller/protocol changes require the reviewed host installer before publishing matching workflows. Normal application deployment cannot replace root-owned controllers, systemd units, Nginx or tunnel configuration. See [CI/CD operations](CI_CD.md).
