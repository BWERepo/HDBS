-- Backs the admin log viewer (api/admin.php's read_log/clear_log/get_error_log actions), which
-- used to read/write plain text files on Hostinger's disk (notify_log.txt, webhook_log.txt,
-- error_log.txt, pages.log). A Worker has no filesystem, so each "file" is now a partition of this
-- one table, keyed by `file`. See src/app-log.ts for the full writeup.
create table if not exists app_log (
  id bigint generated always as identity primary key,
  file text not null check (file in ('notify_log.txt', 'webhook_log.txt', 'error_log.txt', 'pages.log')),
  context text not null,
  message text not null,
  logged_at timestamptz not null default now()
);

create index if not exists app_log_file_logged_at_idx on app_log (file, logged_at);

alter table app_log enable row level security;

notify pgrst, 'reload schema';
