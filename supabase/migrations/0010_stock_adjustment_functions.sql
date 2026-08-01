-- 0010_stock_adjustment_functions — atomic stock decrement/increment for order creation.
--
-- api/orders.php's POST action decrements stock with a single conditional UPDATE
-- (`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`), checking rowCount to
-- detect oversell. PostgREST's REST interface can't express "stock = stock - $1" (it only sets
-- literal column values, not computed expressions) or a conditional update whose result the
-- caller can branch on in one round trip — that requires a real function.
--
-- Business logic (which item gets which price, admin-vs-guest trust boundary, what counts as a
-- valid order) stays in src/orders.ts, same as everywhere else in this migration. These two
-- functions do ONLY the atomic arithmetic a plain REST update can't express — nothing else was
-- moved into SQL.

create or replace function decrement_stock_if_available(p_product_id text, p_qty integer)
returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update products set stock = stock - p_qty
  where id = p_product_id and stock >= p_qty;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Used both to restore stock when compensating a failed multi-item order (src/orders.ts rolls
-- back any already-decremented items rather than leaving a half-applied order, since there's no
-- multi-table transaction across separate REST calls) and to reclaim stock from stale
-- (2h+ unpaid) abandoned orders, matching api/orders.php's existing stale-order cleanup pass.
create or replace function increment_stock(p_product_id text, p_qty integer)
returns void
language plpgsql
as $$
begin
  update products set stock = stock + p_qty where id = p_product_id;
end;
$$;
