-- Optional performance migration for the separate incoming catalog project only.
-- Do not apply this to the existing match/auth project unless it also has this schema.
-- Safe to run repeatedly; these indexes cover the two offers -> teams foreign keys.

create index if not exists idx_offers_buyer_team_id
  on public.offers (buyer_team_id);

create index if not exists idx_offers_seller_team_id
  on public.offers (seller_team_id);
