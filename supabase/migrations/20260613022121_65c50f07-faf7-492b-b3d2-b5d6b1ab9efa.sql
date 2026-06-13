
CREATE TABLE IF NOT EXISTS public.match_odds (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  home_pct numeric(5,2),
  draw_pct numeric(5,2),
  away_pct numeric(5,2),
  source text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.match_odds TO authenticated;
GRANT ALL ON public.match_odds TO service_role;

ALTER TABLE public.match_odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "odds readable by authenticated"
ON public.match_odds FOR SELECT TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.get_match_consensus(match_uuid uuid)
RETURNS TABLE (home_pct numeric, draw_pct numeric, away_pct numeric, total integer, locked boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ko timestamptz;
  is_locked boolean;
  c_home int := 0;
  c_draw int := 0;
  c_away int := 0;
  c_total int := 0;
BEGIN
  SELECT kickoff_at INTO ko FROM public.matches WHERE id = match_uuid;
  is_locked := ko IS NOT NULL AND now() >= ko;

  IF NOT is_locked THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, 0, false;
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE outcome = '1'),
    count(*) FILTER (WHERE outcome = 'X'),
    count(*) FILTER (WHERE outcome = '2'),
    count(*)
  INTO c_home, c_draw, c_away, c_total
  FROM public.predictions
  WHERE match_id = match_uuid;

  IF c_total = 0 THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric, 0, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    round(c_home::numeric * 100 / c_total, 1),
    round(c_draw::numeric * 100 / c_total, 1),
    round(c_away::numeric * 100 / c_total, 1),
    c_total,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_consensus(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_consensus(uuid) TO authenticated;
