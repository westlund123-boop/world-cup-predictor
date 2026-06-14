
CREATE OR REPLACE FUNCTION public.enforce_prediction_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  ko timestamptz;
  uid uuid;
BEGIN
  uid := auth.uid();
  -- Allow service-role / server-side recalculation (no auth.uid()) and admins.
  IF uid IS NULL OR private.has_role(uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  SELECT kickoff_at INTO ko FROM public.matches WHERE id = NEW.match_id;
  IF ko IS NULL THEN
    RAISE EXCEPTION 'match not found';
  END IF;
  IF now() >= ko THEN
    RAISE EXCEPTION 'Predictions are locked for this match';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_prediction_lock_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  ko timestamptz;
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL OR private.has_role(uid, 'admin'::public.app_role) THEN
    RETURN OLD;
  END IF;
  SELECT kickoff_at INTO ko FROM public.matches WHERE id = OLD.match_id;
  IF ko IS NOT NULL AND now() >= ko THEN
    RAISE EXCEPTION 'Predictions are locked for this match';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_prediction_scorer_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  ko timestamptz;
  pid uuid;
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL OR private.has_role(uid, 'admin'::public.app_role) THEN
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
$function$;
