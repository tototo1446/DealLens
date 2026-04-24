-- 商談動画解析ツール 初期スキーマ
-- 実行: Supabase SQL Editor または `supabase db push`

create extension if not exists "pgcrypto";

create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('upload','drive_url','gigafile')),
  source_uri text not null,
  original_filename text,
  status text not null default 'queued'
    check (status in ('queued','downloading','transcoding','analyzing','writing_sheet','done','failed')),
  industry text,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analysis_jobs_status_idx on analysis_jobs (status);
create index if not exists analysis_jobs_industry_idx on analysis_jobs (industry);
create index if not exists analysis_jobs_created_at_idx on analysis_jobs (created_at desc);

create table if not exists extraction_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references analysis_jobs(id) on delete cascade,
  category_key text not null,
  value jsonb not null,
  confidence numeric,
  evidence text,
  created_at timestamptz not null default now()
);

create index if not exists extraction_results_job_idx on extraction_results (job_id);

create table if not exists transcripts (
  job_id uuid primary key references analysis_jobs(id) on delete cascade,
  full_text text not null,
  segments jsonb,
  created_at timestamptz not null default now()
);

-- 内部利用前提なので RLS は無効でService Role経由のみ
alter table analysis_jobs disable row level security;
alter table extraction_results disable row level security;
alter table transcripts disable row level security;
