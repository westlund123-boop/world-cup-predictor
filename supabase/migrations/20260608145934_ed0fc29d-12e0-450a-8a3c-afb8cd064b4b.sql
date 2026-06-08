CREATE OR REPLACE FUNCTION public.enforce_top_scorer_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  first_ko timestamptz;
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NOT NULL AND private.has_role(uid, 'admin'::public.app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT MIN(kickoff_at) INTO first_ko FROM public.matches;

  IF first_ko IS NOT NULL AND now() >= first_ko THEN
    RAISE EXCEPTION 'Top Scorer League predictions are locked — the tournament has started';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS enforce_top_scorer_lock_parent ON public.top_scorer_predictions;
CREATE TRIGGER enforce_top_scorer_lock_parent
  BEFORE INSERT OR UPDATE OR DELETE ON public.top_scorer_predictions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_top_scorer_lock();

DROP TRIGGER IF EXISTS enforce_top_scorer_lock_picks ON public.top_scorer_prediction_picks;
CREATE TRIGGER enforce_top_scorer_lock_picks
  BEFORE INSERT OR UPDATE OR DELETE ON public.top_scorer_prediction_picks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_top_scorer_lock();