
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS needs_repick boolean NOT NULL DEFAULT false;

-- Mark open-match predictions that had >1 other scorer
UPDATE public.predictions p
SET needs_repick = true
WHERE EXISTS (
  SELECT 1 FROM public.matches m WHERE m.id = p.match_id AND m.kickoff_at > now()
)
AND (
  SELECT count(*) FROM public.prediction_scorers ps WHERE ps.prediction_id = p.id
) > 1;

-- Clear those scorer picks so the user must re-pick before kickoff
DELETE FROM public.prediction_scorers ps
USING public.predictions p, public.matches m
WHERE ps.prediction_id = p.id
  AND p.match_id = m.id
  AND m.kickoff_at > now()
  AND p.needs_repick = true;

-- Enforce: at most ONE other goalscorer per prediction (locked matches are not re-inserted into)
CREATE OR REPLACE FUNCTION public.enforce_single_other_scorer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.prediction_scorers WHERE prediction_id = NEW.prediction_id;
  IF cnt >= 1 THEN
    RAISE EXCEPTION 'Only one other goalscorer is allowed per prediction';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prediction_scorers_single_other ON public.prediction_scorers;
CREATE TRIGGER prediction_scorers_single_other
BEFORE INSERT ON public.prediction_scorers
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_other_scorer();
