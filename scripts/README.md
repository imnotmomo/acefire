# Automatic Git sync

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
