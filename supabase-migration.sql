-- =============================================
-- 공장 재고관리 앱 마이그레이션
-- Supabase SQL Editor에서 순서대로 실행해줘
-- =============================================

-- 1. companies (거래처) 테이블
create table if not exists companies (
  id bigint generated always as identity primary key,
  name text not null,
  memo text,
  is_favorite boolean default false,
  created_at timestamptz default now()
);

-- 2. invoices (계산서 헤더)
create table if not exists invoices (
  id bigint generated always as identity primary key,
  company_id bigint references companies(id) on delete set null,
  company_name text not null,
  direction text not null check (direction in ('receivable', 'payable')),
  date date not null,
  invoice_issued boolean default false,
  payment_done boolean default false,
  note text,
  created_at timestamptz default now()
);

-- 3. invoice_items (계산서 품목 라인)
create table if not exists invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoices(id) on delete cascade,
  item_name text,
  quantity numeric default 0,
  unit_price numeric default 0,
  supply_amount numeric default 0,
  tax_amount numeric default 0,
  created_at timestamptz default now()
);

-- 4. inventory_logs에 거래처 컬럼 추가
--    (이미 추가되어 있으면 오류 무시해도 됨)
alter table inventory_logs
  add column if not exists company_id bigint references companies(id) on delete set null,
  add column if not exists company_name text;

-- =============================================
-- 2차 수정 마이그레이션 (추가 실행)
-- =============================================

-- inventory_logs에 date 컬럼 추가 (빠른입력 날짜 버그 수정)
alter table inventory_logs add column if not exists date date;

-- invoices에 factory 컬럼 추가 (공장별 계산서 발행)
alter table invoices add column if not exists factory text check (factory in ('1공장', '2공장')) default null;

-- =============================================
-- RLS 설정 (필요시)
-- =============================================
-- alter table companies enable row level security;
-- alter table invoices enable row level security;
-- alter table invoice_items enable row level security;
--
-- create policy "authenticated users can access companies"
--   on companies for all to authenticated using (true) with check (true);
--
-- create policy "authenticated users can access invoices"
--   on invoices for all to authenticated using (true) with check (true);
--
-- create policy "authenticated users can access invoice_items"
--   on invoice_items for all to authenticated using (true) with check (true);
