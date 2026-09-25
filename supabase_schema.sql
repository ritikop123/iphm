-- ====================================================================
-- IPHM.NETWORK — Hardened Production Supabase Database Setup & Security
-- ====================================================================
-- Instructions:
-- 1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/izutiszeevhhkfaolblw
-- 2. Open the "SQL Editor" from the left menu.
-- 3. Paste this script into the editor and click "Run" (green button).
-- 4. To grant admin access to an email, run the command at the very bottom!
-- ====================================================================

-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- --------------------------------------------------------------------
-- 1. PROFILES TABLE (Stores user roles: 'user' or 'admin' and credentials)
-- --------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  role text default 'user' check (role in ('user', 'admin')),
  current_password text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Ensure current_password column exists if table is already created
alter table public.profiles add column if not exists current_password text;

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- --------------------------------------------------------------------
-- 2. HELPER FUNCTION: is_admin()
-- --------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
end;
$$ language plpgsql security definer;

-- --------------------------------------------------------------------
-- 3. PROFILES RLS POLICIES (Hardened against Privilege Escalation)
-- --------------------------------------------------------------------
drop policy if exists "Profiles are viewable by owner or admin" on public.profiles;
create policy "Profiles are viewable by owner or admin" 
on public.profiles for select 
using (
  auth.uid() = id 
  or public.is_admin()
);

-- Allow users to insert their own profile
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" 
on public.profiles for insert 
with check (
  auth.uid() = id 
  and (role is null or role = 'user' or public.is_admin())
);

-- Hardened: Non-admin users can update their profile, but CANNOT elevate their role to admin!
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" 
on public.profiles for update 
using (auth.uid() = id or public.is_admin())
with check (
  public.is_admin() 
  or (auth.uid() = id and role = 'user')
);

drop policy if exists "Admins have full access to profiles" on public.profiles;
create policy "Admins have full access to profiles" 
on public.profiles for all 
using (public.is_admin());

-- --------------------------------------------------------------------
-- 4. AUTOMATIC PROFILE CREATION ON USER SIGNUP TRIGGER
-- --------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing auth.users into public.profiles
insert into public.profiles (id, email, role)
select id, email, 'user'
from auth.users
on conflict (id) do nothing;

-- --------------------------------------------------------------------
-- 5. ORDERS TABLE (Stores purchases, payments, TXID, and approval status)
-- --------------------------------------------------------------------
create table if not exists public.orders (
  id uuid default gen_random_uuid() primary key,
  order_ref text unique not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text not null,
  provider_id integer not null,
  provider_name text not null,
  provider_url text,
  city text,
  country text,
  machine_type text,
  pps text,
  nic text,
  amount_usd numeric(10,2),
  crypto_amount text,
  payment_coin text,
  txid text not null,
  status text default 'pending' check (status in ('pending', 'approved', 'cancelled')),
  admin_notes text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Index for speedy queries
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_user_email on public.orders(user_email);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);

-- Enable Row Level Security
alter table public.orders enable row level security;

-- --------------------------------------------------------------------
-- 6. ORDERS RLS POLICIES (Hardened against Unauthorized Pre-Approval)
-- --------------------------------------------------------------------
-- Hardened: Anyone submitting payment can insert an order, but status MUST be 'pending'!
drop policy if exists "Anyone can insert orders" on public.orders;
create policy "Anyone can insert orders" 
on public.orders for insert 
with check (
  status = 'pending' 
  or public.is_admin()
);

-- Users can view ONLY their own orders; admins can view all orders
drop policy if exists "Users view own orders, admins view all" on public.orders;
create policy "Users view own orders, admins view all" 
on public.orders for select 
using (
  auth.uid() = user_id 
  or (user_email = auth.jwt() ->> 'email' and auth.jwt() ->> 'email' is not null)
  or public.is_admin()
);

-- ONLY verified admins can approve, reject, or update orders
drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders" 
on public.orders for update 
using (public.is_admin());

-- --------------------------------------------------------------------
-- 7. ENABLE REALTIME UPDATES FOR ORDERS (Idempotent)
-- --------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- --------------------------------------------------------------------
-- 8. PROVIDERS TABLE (Zero plain text upstream secrets exposed)
-- --------------------------------------------------------------------
create table if not exists public.providers (
  id serial primary key,
  city text not null,
  country text not null,
  country_code text not null default 'us',
  type text not null check (type in ('VPS', 'Dedicated')),
  pps text not null,
  pps_num integer default 150000,
  nic text not null,
  spoofing text not null default 'Working',
  updated_ago text default 'Just now',
  price_usd numeric(10,2) not null,
  price_ltc text,
  revealed_name text default 'Verified Host Gateway',
  revealed_url text default 'https://iphm.network',
  is_hidden boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.providers enable row level security;

-- Everyone can read active non-hidden providers; admins can read all
drop policy if exists "Anyone can read providers" on public.providers;
create policy "Anyone can read providers" on public.providers
  for select using (is_hidden = false or public.is_admin());

-- Only verified admins can insert/update/delete providers
drop policy if exists "Admins can manage providers" on public.providers;
create policy "Admins can manage providers" on public.providers
  for all using (public.is_admin());

-- Realtime (Idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'providers'
  ) then
    alter publication supabase_realtime add table public.providers;
  end if;
end $$;

-- Column-Level Protection:
-- Restrict column SELECT so anon and regular users can NEVER query sensitive columns over the wire
revoke select on public.providers from anon, authenticated;
grant select (id, city, country, country_code, type, pps, pps_num, nic, spoofing, updated_ago, price_usd, price_ltc, is_hidden, created_at, updated_at) 
on public.providers to anon, authenticated;

-- Scrub any existing upstream secrets from the database table
update public.providers
set revealed_name = 'Verified Host Gateway',
    revealed_url = 'https://iphm.network';

-- IMPORTANT: Do not seed demo provider cards here.
-- The admin must create every listing manually in Supabase and publish it with is_hidden = false.
-- The homepage should remain empty until a real provider card is added.

-- Ensure sequence matches highest existing id without inserting demo rows
select setval(pg_get_serial_sequence('public.providers', 'id'), coalesce(max(id), 1)) from public.providers;

-- --------------------------------------------------------------------
-- 9. HOW TO ASSIGN THE ADMIN ROLE TO YOUR ACCOUNT
-- --------------------------------------------------------------------
-- Replace 'your_email@proton.me' with the email you use to sign in:
--
--   UPDATE public.profiles 
--   SET role = 'admin' 
--   WHERE email = 'your_email@proton.me';
--
-- You can verify with:
--   SELECT * FROM public.profiles WHERE role = 'admin';
-- ====================================================================
