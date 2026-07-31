# Handmade Designs By Suzi — User Manual

## Backups

### Manual backup (on demand)
Ask Claude Code to run `/BWEHDBSBackup` (or say "backup" / "back up HDBS") while
working in this project. This produces two timestamped files in
`Z:\Backup\Websites\HDBS\Backup\`:

- `<yyyyMMddHHmm>HDBS.sql` — full MySQL database dump, downloaded from
  `api/db_backup.php?download=1`
- `<yyyyMMddHHmm>HDBS.zip` — full zip of the `HandmadeDesignsBySuzi` repo folder
  (including product images and untracked secrets files)

Both files are additive — nothing is ever overwritten or deleted, so it's always
safe to run.

### Setting up automatic daily backups

Daily backups are run by scheduling `/BWEHDBSBackup` as a recurring Claude Code
task, using the built-in `schedule` skill:

1. In a Claude Code session (any project), say something like:
   > Schedule a daily task that runs `/BWEHDBSBackup` in the
   > `Z:\Backup\Websites\HandmadeDesignsBySuzi` project every day at [time].
2. Claude will create the scheduled task via the scheduled-tasks tooling and
   confirm the cron/time it registered.
3. Each run performs the same two steps as the manual backup above, writing new
   timestamped files to `Z:\Backup\Websites\HDBS\Backup\` — old backups are
   never deleted automatically, so periodically prune that folder by hand if
   disk space becomes a concern.

**Prerequisites for the scheduled run to succeed:**
- `api/db_backup.php`'s `?download=1` mode must already be deployed to
  production (deployed 2026-07-28; re-deploy with
  `.\deploy.ps1 api\db_backup.php` from this folder if it's ever missing).
- The backup token must be stored in Windows Credential Manager under target
  `HDBS-Backup-Token` (username `backup_token`). If it's missing or stale, get
  the current token from **Admin → Developer → DB Backup** on the live site
  and store it with:
  ```powershell
  Import-Module CredentialManager
  New-StoredCredential -Target "HDBS-Backup-Token" -UserName "backup_token" -Password "<paste token here>" -Persist LocalMachine
  ```
  > **Note:** run this yourself in a PowerShell window — never paste the real
  > token into a chat message or ask Claude to run it with the token filled
  > in, since that would put the token in the conversation transcript.
- The machine running the scheduled task must have network access to
  `handmadedesignsbysuzi.com` and enough free space at
  `Z:\Backup\Websites\HDBS\Backup\`.

To check, list, or remove the scheduled backup later, ask Claude to list your
scheduled tasks (or manage them via the `schedule` skill).

**Note:** there was already a separate, pre-existing daily cron on the
Hostinger server itself that emails the DB dump as an attachment to
`handmadedesignsbysuzi@yahoo.com` (see the "📦 Manual Backup" panel in
Admin → Developer for the on-demand version of that same email path). The
scheduled-task approach above is independent of that — it saves both a `.sql`
and a full repo `.zip` locally instead of emailing.
