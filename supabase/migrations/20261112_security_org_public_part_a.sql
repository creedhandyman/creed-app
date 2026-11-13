-- Creed security fix, part A
-- Safe to run now: it only adds things and tightens rules nothing in the app relies on.
-- Applied to "Creed handy app" on 2026-11-12 (migration security_fix_part_a).

-- 1. A short public view of each business: only what the public pages show.
create or replace view public.org_public
with (security_barrier = true) as
select id, created_at, name, phone, email, address, license_num, logo_url,
       site_slug, site_published, site_content, site_theme, gallery_photos,
       brand_color, brand_color_2, licensed_trades, primary_trade,
       booking_enabled, google_review_url
from public.organizations;
revoke all on public.org_public from anon, authenticated;
grant select on public.org_public to anon, authenticated;

-- 2. "Does this business exist?" without reading its record.
create or replace function public.org_exists(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from organizations where id = p_org) $$;
revoke all on function public.org_exists(uuid) from public;
grant execute on function public.org_exists(uuid) to anon, authenticated;

-- 3. Remember who created a business, so sign up still works once public reading is off.
alter table public.organizations add column if not exists created_by uuid default auth.uid();
drop policy if exists "Creator reads new org" on public.organizations;
create policy "Creator reads new org" on public.organizations
  for select to authenticated
  using (created_by = auth.uid() and created_at > now() - interval '1 day');

-- 4. Billing fields: only Creed's server (Stripe webhook, promo codes, admin) may set them.
--    Today an owner can switch billing_enforced off or mark themselves paid from the browser.
create or replace function public.guard_org_billing()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;  -- service role and the SQL editor pass through
  end if;
  if tg_op = 'INSERT' then
    new.subscription_status    := 'trial';
    new.billing_enforced       := true;
    new.trial_start            := now();
    new.trial_ends_at          := null;
    new.subscription_plan      := null;
    new.stripe_customer_id     := null;
    new.stripe_subscription_id := null;
    new.stripe_account_id      := null;
    new.stripe_connected       := false;
    new.created_by             := auth.uid();
    return new;
  end if;
  if new.subscription_status    is distinct from old.subscription_status
  or new.billing_enforced       is distinct from old.billing_enforced
  or new.trial_start            is distinct from old.trial_start
  or new.trial_ends_at          is distinct from old.trial_ends_at
  or new.subscription_plan      is distinct from old.subscription_plan
  or new.stripe_customer_id     is distinct from old.stripe_customer_id
  or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  or new.stripe_account_id      is distinct from old.stripe_account_id
  or new.stripe_connected       is distinct from old.stripe_connected
  or new.created_by             is distinct from old.created_by then
    raise exception 'Billing fields can only be changed by Creed''s server'
      using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists guard_org_billing on public.organizations;
create trigger guard_org_billing
  before insert or update on public.organizations
  for each row execute function public.guard_org_billing();

-- 5. Reviews: only for a real business, rating 1 to 5, sane lengths.
drop policy if exists "Org insert reviews" on public.reviews;
drop policy if exists "Insert reviews for a real business" on public.reviews;
create policy "Insert reviews for a real business" on public.reviews
  for insert to anon, authenticated
  with check (
    public.org_exists(org_id)
    and rating between 1 and 5
    and char_length(coalesce(review_text, ''))    <= 2000
    and char_length(coalesce(client_name, ''))    <= 100
    and char_length(coalesce(employee_names, '')) <= 500
  );

-- 6. Photo bucket: signed-out visitors may upload only into the leads/ folder
--    (the website quote form's photos), not anywhere in the bucket.
drop policy if exists "allow all 1lnm9mj_0" on storage.objects;
drop policy if exists "Public lead photo uploads" on storage.objects;
create policy "Public lead photo uploads" on storage.objects
  for insert to anon
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'leads');

-- Follow-up applied the same day (Security Advisor note): pin the trigger's search path.
alter function public.guard_org_billing() set search_path = public;
