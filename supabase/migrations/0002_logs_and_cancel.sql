-- ログと中断機能のための拡張
-- 実行: Supabase SQL Editor

-- status に cancelling / cancelled を追加
alter table analysis_jobs drop constraint if exists analysis_jobs_status_check;
alter table analysis_jobs
  add constraint analysis_jobs_status_check
  check (status in ('queued','downloading','transcoding','analyzing','writing_sheet','done','failed','cancelling','cancelled'));

-- キャンセル要求フラグ
alter table analysis_jobs
  add column if not exists cancel_requested boolean not null default false;

-- ジョブ実行ログ
create table if not exists job_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references analysis_jobs(id) on delete cascade,
  level text not null default 'info' check (level in ('info','warn','error')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists job_logs_job_id_created_at_idx
  on job_logs (job_id, created_at);

alter table job_logs disable row level security;
