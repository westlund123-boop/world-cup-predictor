
CREATE TABLE IF NOT EXISTS public.top_scorer_unlocks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.top_scorer_unlocks TO authenticated;
GRANT ALL ON public.top_scorer_unlocks TO service_role;

ALTER TABLE public.top_scorer_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users see own unlock" ON public.top_scorer_unlocks;
CREATE POLICY "users see own unlock" ON public.top_scorer_unlocks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage unlocks" ON public.top_scorer_unlocks;
CREATE POLICY "admins manage unlocks" ON public.top_scorer_unlocks
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.enforce_top_scorer_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  first_ko timestamptz;
  uid uuid;
  target_uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL OR private.has_role(uid, 'admin'::public.app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  target_uid := COALESCE(NEW.user_id, OLD.user_id);
  IF EXISTS (SELECT 1 FROM public.top_scorer_unlocks WHERE user_id = target_uid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT MIN(kickoff_at) INTO first_ko FROM public.matches;
  IF first_ko IS NOT NULL AND now() >= first_ko THEN
    RAISE EXCEPTION 'Top Scorer League predictions are locked — the tournament has started';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
