-- ============================================================================
-- Bale Drop — real catalog search: full-text index, synonyms, ranking and
-- pagination. Apply after 0025_promo_accounting.sql.
--
-- Until now the live path was `ILIKE` over three columns ordered by
-- `sold_count` (a counter nothing maintained — see 0024). The scored search in
-- `packages/database/src/search.ts` (tokens, synonyms, MATCH_THRESHOLD) only
-- ever ran in the browser against demo data and in unit tests, so live buyers
-- got no relevance ranking and no synonym matches, and results were hard-capped
-- at 40 rows with no way to page.
--
-- This moves ranking into Postgres where the data is:
--   * `products.search_vector` — weighted generated tsvector + GIN index;
--   * `search_synonyms`        — ops-editable, mirrors SEARCH_SYNONYMS;
--   * `search_products()`      — one RPC returning ranked rows + exact total.
--
-- The function is SECURITY INVOKER: it sees exactly what the caller's RLS
-- allows, so it cannot become a read hole.
-- ============================================================================

-- ---------- weighted full-text vector ----------

alter table public.products
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(category, '')), 'B')
    || setweight(to_tsvector('english', coalesce(coalesce(pieces_estimate, '') || ' ' || coalesce(city, ''))), 'C')
    || setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) stored;

create index if not exists products_search_vector_idx
  on public.products using gin (search_vector);

-- ---------- synonyms ----------

create table if not exists public.search_synonyms (
  term text primary key,
  category text not null,
  created_at timestamptz not null default now()
);

alter table public.search_synonyms enable row level security;

create policy "synonyms public read" on public.search_synonyms for select
  using (true);
create policy "synonyms admin write" on public.search_synonyms for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.search_synonyms (term, category) values
  ('sneaker', 'Shoes'), ('sneakers', 'Shoes'), ('shoe', 'Shoes'), ('shoes', 'Shoes'),
  ('trainer', 'Shoes'), ('trainers', 'Shoes'),
  ('jacket', 'Vintage'), ('jackets', 'Vintage'), ('denim', 'Vintage'), ('vintage', 'Vintage'),
  ('hoodie', 'Men'), ('hoodies', 'Men'), ('shirt', 'Men'), ('shirts', 'Men'),
  ('gown', 'Women'), ('gowns', 'Women'), ('dress', 'Women'), ('dresses', 'Women'),
  ('bag', 'Bags'), ('bags', 'Bags'), ('handbag', 'Bags'), ('handbags', 'Bags'),
  ('kid', 'Kids'), ('kids', 'Kids'), ('children', 'Kids'), ('baby', 'Kids'),
  ('bale', 'Bales'), ('bales', 'Bales'),
  ('okirika', 'All'), ('thrift', 'All'), ('secondhand', 'All')
on conflict (term) do update set category = excluded.category;

-- ---------- the search RPC ----------

create or replace function public.search_products(
  p_query text default null,
  p_category text default null,
  p_city text default null,
  p_grade text default null,
  p_kind text default null,
  p_vendor_id uuid default null,
  p_min_naira int default null,
  p_max_naira int default null,
  p_sort text default null,
  p_limit int default 24,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_term text;
  v_pattern text;
  v_tsquery tsquery;
  v_synonyms text[];
  v_limit int;
  v_offset int;
  v_sort text;
  v_rows jsonb;
  v_total bigint;
begin
  -- Input hygiene mirrors `sanitizeRemoteQuery()` / `escapeLikePattern()`:
  -- strip the characters that could reshape a filter, cap the length, and
  -- escape LIKE wildcards. Never trust a buyer's punctuation.
  v_term := lower(trim(regexp_replace(coalesce(p_query, ''), '[^A-Za-z0-9 ''-]', ' ', 'g')));
  v_term := left(regexp_replace(v_term, '\s+', ' ', 'g'), 80);
  v_pattern := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  v_limit := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_sort := case
    when p_sort in ('newest', 'price_asc', 'price_desc', 'rating', 'relevance') then p_sort
    else case when v_term <> '' then 'relevance' else 'newest' end
  end;

  if v_term <> '' then
    begin
      v_tsquery := websearch_to_tsquery('english', v_term);
    exception when others then
      v_tsquery := null;
    end;
    select coalesce(array_agg(distinct s.category), '{}') into v_synonyms
    from public.search_synonyms s
    where s.category <> 'All'
      and s.term = any (regexp_split_to_array(v_term, '\s+'));
  else
    v_tsquery := null;
    v_synonyms := '{}';
  end if;

  with scored as (
    select
      to_jsonb(p) - 'search_vector' as row_json,
      p.created_at as created_at,
      -- Relevance: full-text weight, an exact-substring bonus, a synonym
      -- category bonus, then a small popularity nudge. Zero for a filter-only
      -- browse, where the chosen sort key decides everything.
      (
        coalesce(ts_rank_cd(p.search_vector, v_tsquery), 0) * 10
        + case when v_term <> '' and position(v_term in lower(p.title)) > 0 then 3 else 0 end
        + case when v_term <> '' and position(v_term in lower(coalesce(p.description, ''))) > 0 then 1 else 0 end
        + case when array_length(v_synonyms, 1) is not null and p.category = any (v_synonyms) then 2 else 0 end
        + least(p.sold_count, 1000) / 1000.0
      ) as rank,
      -- One ascending key per sort so `order by` stays a single expression.
      case v_sort
        when 'price_asc'  then p.price_naira::numeric
        when 'price_desc' then (-p.price_naira)::numeric
        when 'rating'     then (-(p.rating_avg * 100000) - p.sold_count)::numeric
        when 'newest'     then -extract(epoch from p.created_at)::numeric
        else -((
          coalesce(ts_rank_cd(p.search_vector, v_tsquery), 0) * 10
          + case when v_term <> '' and position(v_term in lower(p.title)) > 0 then 3 else 0 end
          + case when v_term <> '' and position(v_term in lower(coalesce(p.description, ''))) > 0 then 1 else 0 end
          + case when array_length(v_synonyms, 1) is not null and p.category = any (v_synonyms) then 2 else 0 end
          + least(p.sold_count, 1000) / 1000.0
        ))::numeric
      end as sort_key,
      count(*) over () as total
    from public.products p
    where p.status = 'active'
      and (nullif(trim(coalesce(p_category, '')), '') is null or p.category = p_category)
      and (nullif(trim(coalesce(p_city, '')), '') is null or p.city = p_city)
      and (nullif(trim(coalesce(p_grade, '')), '') is null or p.grade = upper(p_grade))
      and (nullif(trim(coalesce(p_kind, '')), '') is null or p.kind = p_kind)
      and (p_vendor_id is null or p.vendor_id = search_products.p_vendor_id)
      and (p_min_naira is null or p.price_naira >= p_min_naira)
      and (p_max_naira is null or p.price_naira <= p_max_naira)
      and (
        v_term = ''
        -- A match means: full-text hit, substring hit, or a synonym category.
        -- Non-matches are excluded, never padded out with popular listings.
        or (v_tsquery is not null and p.search_vector @@ v_tsquery)
        or p.title ilike v_pattern
        or p.category ilike v_pattern
        or coalesce(p.description, '') ilike v_pattern
        or (array_length(v_synonyms, 1) is not null and p.category = any (v_synonyms))
      )
  )
  select
    coalesce(jsonb_agg(x.row_json order by x.sort_key asc, x.rank desc, x.created_at desc), '[]'::jsonb),
    coalesce(max(x.total), 0)
  into v_rows, v_total
  from (
    select * from scored
    order by sort_key asc, rank desc, created_at desc
    limit v_limit offset v_offset
  ) x;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'sort', v_sort,
    'pages', greatest(1, ceil(v_total::numeric / v_limit)::int)
  );
end;
$$;

revoke all on function public.search_products(text, text, text, text, text, uuid, int, int, text, int, int) from public;
grant execute on function public.search_products(text, text, text, text, text, uuid, int, int, text, int, int)
  to anon, authenticated, service_role;
