# Repository utilities

Application deployment is configured by the repository’s CI/CD workflow and the
[home server runbook](../deploy/home-vm/README.md). The Windows utility below is
a local development convenience: it commits and pushes source changes. It does
not install a server, manage runtime secrets or verify a production release.

## CI checks

- `ci/backend.sh` runs the backend suite with the repository’s fixture paths. Set
  `PYTHON` to an installed Python environment containing `backend/requirements.lock`.
  Node and the installed frontend dependencies are required for its PDF export
  round-trip tests.
- `ci/frontend.sh` installs locked frontend dependencies, runs frontend and
  disabled-Roundtable tests, builds the frontend and checks deployment shell syntax.

Use `make test` from the repository root to run both. Native LibreOffice/OCR tools
must already be installed for the backend checks; the workflow prepares them.

## Optional Windows frontend auto-push

`auto-push.ps1` commits changes under `frontend/` and pushes to `origin/main`.
Put new application code and assets in `frontend/`. Other directories are not
automatically staged. If another directory has staged changes, sync stops so
those changes can be handled manually. As with any Git push, all existing local
commits on main are pushed, so review manual commits before enabling sync.
The Windows scheduled task `Acefire-AutoPush` runs it every five minutes while
the Windows user is logged in. The computer must be awake and online.

The script excludes paths in `.gitignore`, including `.env` files, Python virtual
environments, and frontend dependencies/build output. It uses existing Git
credentials without interactive prompts. If authentication expires, sign in
again with a manual `git push`.

When remote main contains commits missing locally, automatic sync stops without
overwriting remote history. Review local changes and integrate remote commits
manually, then the next run can resume.

Run once from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto-push.ps1
```

Inspect status and logs:

```powershell
Get-ScheduledTaskInfo -TaskName Acefire-AutoPush
Get-Content .git\auto-push.log -Tail 30
```

Disable or enable automatic syncing:

```powershell
Disable-ScheduledTask -TaskName Acefire-AutoPush
Enable-ScheduledTask -TaskName Acefire-AutoPush
```
