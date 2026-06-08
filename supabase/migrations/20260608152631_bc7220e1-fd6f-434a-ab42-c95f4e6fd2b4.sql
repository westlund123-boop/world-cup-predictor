
-- 1. Lock down user_roles SELECT
DROP POLICY IF EXISTS "user_roles readable by authenticated" ON public.user_roles;

CREATE POLICY "users read own role"
ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "admins read all roles"
ON public.user_roles
FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- (No INSERT/UPDATE/DELETE policies exist on user_roles for authenticated;
--  writes happen only via SECURITY DEFINER handle_new_user / service_role.)

-- 2. Extend prediction lock to DELETE
DROP TRIGGER IF EXISTS predictions_lock_del ON public.predictions;

CREATE OR REPLACE FUNCTION public.enforce_prediction_lock_del()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ko timestamptz;
BEGIN
  IF private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN OLD;
  END IF;

  SELECT kickoff_at INTO ko FROM public.matches WHERE id = OLD.match_id;

  IF ko IS NOT NULL AND now() >= ko THEN
    RAISE EXCEPTION 'Predictions are locked for this match';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER predictions_lock_del
BEFORE DELETE ON public.predictions
FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_lock_del();

-- Tighten DELETE policy as defense-in-depth
DROP POLICY IF EXISTS "users delete own predictions" ON public.predictions;
CREATE POLICY "users delete own predictions before kickoff"
ON public.predictions
FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  AND (
    private.has_role(auth.uid(), 'admin'::public.app_role)
    OR NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = predictions.match_id AND m.kickoff_at <= now()
    )
  )
);

-- 3. Lock prediction_scorers writes by match kickoff
CREATE OR REPLACE FUNCTION public.enforce_prediction_scorer_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ko timestamptz;
  pid uuid;
BEGIN
  IF private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  pid := COALESCE(NEW.prediction_id, OLD.prediction_id);

  SELECT m.kickoff_at INTO ko
  FROM public.predictions p
  JOIN public.matches m ON m.id = p.match_id
  WHERE p.id = pid;

  IF ko IS NOT NULL AND now() >= ko THEN
    RAISE EXCEPTION 'Predictions are locked for this match';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS prediction_scorers_lock ON public.prediction_scorers;
CREATE TRIGGER prediction_scorers_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.prediction_scorers
FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_scorer_lock();
