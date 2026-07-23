-- ============================================================
-- NairaPlus — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- 1. PROFILES (extends Supabase's built-in auth.users)
create table profiles (
  id uuid references auth.users(id) primary key,
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text not null,
  referral_code text unique not null,
  referred_by text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- 2. WALLETS (one row per user — balance only ever changes via functions below)
create table wallets (
  user_id uuid references profiles(id) primary key,
  balance numeric default 0,
  commission_balance numeric default 0,
  trust_score int default 0
);

-- 3. TIERS (admin can edit rates directly in the table editor)
create table tiers (
  name text primary key,
  min_score int not null,
  max_score int not null,
  rate_min numeric not null,
  rate_max numeric not null,
  daily_cap int not null,
  sort_order int not null
);

insert into tiers (name, min_score, max_score, rate_min, rate_max, daily_cap, sort_order) values
  ('Starter', 0,   19,  80,  150,  3,   1),
  ('Bronze',  20,  49,  150, 350,  6,   2),
  ('Silver',  50,  99,  350, 600,  10,  3),
  ('Legend',  100, 999999, 600, 1000, 999, 4);

-- 4. BUSINESSES (the review tasks — admin manages these)
create table businesses (
  id serial primary key,
  name text not null,
  category text not null,
  icon text default 'fa-store',
  active boolean default true,
  created_at timestamptz default now()
);

insert into businesses (name, category, icon) values
  ('Mama Kemi''s Kitchen', 'Restaurant', 'fa-utensils'),
  ('Zenith Auto Spares', 'Auto Parts', 'fa-car'),
  ('Bella''s Boutique', 'Fashion', 'fa-shirt'),
  ('GreenLeaf Pharmacy', 'Pharmacy', 'fa-mortar-pestle'),
  ('Sunrise Barbing Salon', 'Grooming', 'fa-scissors'),
  ('TechHub Phone Repairs', 'Electronics', 'fa-mobile-screen'),
  ('Golden Crust Bakery', 'Bakery', 'fa-bread-slice'),
  ('Ace Fitness Gym', 'Fitness', 'fa-dumbbell'),
  ('Divine Touch Spa', 'Wellness', 'fa-spa'),
  ('Ekene Furniture Works', 'Furniture', 'fa-couch'),
  ('Blue Wave Laundry', 'Laundry', 'fa-shirt'),
  ('Naija Fresh Supermarket', 'Grocery', 'fa-cart-shopping'),
  ('Prestige Driving School', 'Education', 'fa-car-side'),
  ('CoolBreeze Electronics', 'Electronics', 'fa-plug'),
  ('Faith Event Rentals', 'Events', 'fa-champagne-glasses');

-- 5. REVIEWS (submitted by users — payout locked in at submit time)
create table reviews (
  id serial primary key,
  user_id uuid references profiles(id) not null,
  business_id int references businesses(id) not null,
  stars int not null check (stars between 1 and 5),
  comment text,
  payout numeric not null,
  created_at timestamptz default now(),
  unique(user_id, business_id) -- one review per business per user
);

-- 6. WITHDRAWALS (user requests; admin approves & pays)
create table withdrawals (
  id serial primary key,
  user_id uuid references profiles(id) not null,
  amount numeric not null,
  bank_name text not null,
  account_number text not null,
  account_name text,
  status text default 'pending', -- pending | approved | rejected | paid
  paystack_transfer_code text,
  admin_note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

-- ============================================================
-- ROW LEVEL SECURITY — locks down who can read/write what
-- ============================================================
alter table profiles enable row level security;
alter table wallets enable row level security;
alter table businesses enable row level security;
alter table reviews enable row level security;
alter table withdrawals enable row level security;
alter table tiers enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin() returns boolean as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$ language sql security definer;

-- Profiles: users see/update their own row; admins see all
create policy "profiles_select_own_or_admin" on profiles for select
  using (auth.uid() = id or is_admin());
create policy "profiles_update_own" on profiles for update
  using (auth.uid() = id);
create policy "profiles_insert_own" on profiles for insert
  with check (auth.uid() = id);

-- Wallets: users see own; NO direct insert/update from client (only via functions below)
create policy "wallets_select_own_or_admin" on wallets for select
  using (auth.uid() = user_id or is_admin());

-- Tiers & businesses: anyone logged in can read; only admins write
create policy "tiers_select_all" on tiers for select using (true);
create policy "tiers_admin_write" on tiers for all using (is_admin()) with check (is_admin());

create policy "businesses_select_all" on businesses for select using (true);
create policy "businesses_admin_write" on businesses for all using (is_admin()) with check (is_admin());

-- Reviews: users see own; admins see all; inserts only via function (see below)
create policy "reviews_select_own_or_admin" on reviews for select
  using (auth.uid() = user_id or is_admin());

-- Withdrawals: users see/create own; only admin can update (approve/reject/pay)
create policy "withdrawals_select_own_or_admin" on withdrawals for select
  using (auth.uid() = user_id or is_admin());
create policy "withdrawals_insert_own" on withdrawals for insert
  with check (auth.uid() = user_id);
create policy "withdrawals_admin_update" on withdrawals for update
  using (is_admin());

-- ============================================================
-- FUNCTIONS — all money logic lives here, not in the browser
-- ============================================================

-- Register: creates profile + wallet in one call (called right after auth.signUp)
create or replace function register_profile(
  p_first_name text, p_last_name text, p_phone text, p_email text, p_referred_by text
) returns void as $$
declare
  new_code text;
begin
  new_code := 'NP' || upper(substr(md5(random()::text), 1, 6));
  insert into profiles (id, first_name, last_name, phone, email, referral_code, referred_by)
  values (auth.uid(), p_first_name, p_last_name, p_phone, p_email, new_code, p_referred_by);
  insert into wallets (user_id, balance, trust_score)
  values (auth.uid(), 0, case when p_referred_by is not null and p_referred_by != '' then 1 else 0 end);
end;
$$ language plpgsql security definer;

-- Submit a review: checks daily cap server-side, computes payout, credits wallet
create or replace function submit_review(
  p_business_id int, p_stars int, p_comment text
) returns json as $$
declare
  v_trust_score int;
  v_tier record;
  v_today_count int;
  v_payout numeric;
begin
  select trust_score into v_trust_score from wallets where user_id = auth.uid();
  select * into v_tier from tiers where v_trust_score between min_score and max_score limit 1;

  select count(*) into v_today_count from reviews
    where user_id = auth.uid() and created_at::date = current_date;

  if v_today_count >= v_tier.daily_cap then
    return json_build_object('success', false, 'message',
      'Daily limit reached for your ' || v_tier.name || ' tier (' || v_tier.daily_cap || '/day).');
  end if;

  if exists (select 1 from reviews where user_id = auth.uid() and business_id = p_business_id) then
    return json_build_object('success', false, 'message', 'You already reviewed this business.');
  end if;

  v_payout := round((v_tier.rate_min + ((p_business_id * 37) % 100)::numeric / 100 * (v_tier.rate_max - v_tier.rate_min)) / 10) * 10;

  insert into reviews (user_id, business_id, stars, comment, payout)
  values (auth.uid(), p_business_id, p_stars, p_comment, v_payout);

  update wallets set balance = balance + v_payout, trust_score = trust_score + 1
    where user_id = auth.uid();

  return json_build_object('success', true, 'message', 'Review submitted!', 'payout', v_payout);
end;
$$ language plpgsql security definer;

-- Request a withdrawal: locks the amount out of balance immediately (held, not deducted-and-gone)
create or replace function request_withdrawal(
  p_amount numeric, p_bank_name text, p_account_number text, p_account_name text
) returns json as $$
declare
  v_balance numeric;
begin
  select balance into v_balance from wallets where user_id = auth.uid();
  if p_amount <= 0 then
    return json_build_object('success', false, 'message', 'Enter a valid amount.');
  end if;
  if p_amount > v_balance then
    return json_build_object('success', false, 'message', 'Amount exceeds your available balance.');
  end if;

  update wallets set balance = balance - p_amount where user_id = auth.uid();

  insert into withdrawals (user_id, amount, bank_name, account_number, account_name)
  values (auth.uid(), p_amount, p_bank_name, p_account_number, p_account_name);

  return json_build_object('success', true, 'message', 'Withdrawal requested — pending admin approval.');
end;
$$ language plpgsql security definer;

-- If admin rejects a withdrawal, refund the held balance
create or replace function reject_withdrawal(p_withdrawal_id int, p_note text) returns void as $$
declare
  v_row record;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  select * into v_row from withdrawals where id = p_withdrawal_id;
  update wallets set balance = balance + v_row.amount where user_id = v_row.user_id;
  update withdrawals set status = 'rejected', admin_note = p_note, processed_at = now()
    where id = p_withdrawal_id;
end;
$$ language plpgsql security definer;
