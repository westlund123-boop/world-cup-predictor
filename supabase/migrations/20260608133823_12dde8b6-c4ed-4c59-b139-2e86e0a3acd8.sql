CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

DROP POLICY IF EXISTS "admins manage predictions" ON public.predictions;
DROP POLICY IF EXISTS "predictions read own or after kickoff" ON public.predictions;
DROP POLICY IF EXISTS "prediction_scorers read own or after kickoff" ON public.prediction_scorers;
DROP POLICY IF EXISTS "top3 read own or after ko start" ON public.top3_predictions;

CREATE POLICY "admins manage predictions"
ON public.predictions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "predictions read own or after kickoff"
ON public.predictions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = predictions.match_id
      AND m.kickoff_at <= now()
  )
);

CREATE POLICY "prediction_scorers read own or after kickoff"
ON public.prediction_scorers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.predictions p
    LEFT JOIN public.matches m ON m.id = p.match_id
    WHERE p.id = prediction_scorers.prediction_id
      AND (
        p.user_id = auth.uid()
        OR (m.kickoff_at IS NOT NULL AND m.kickoff_at <= now())
      )
  )
);

CREATE POLICY "top3 read own or after ko start"
ON public.top3_predictions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.stage <> 'group'::public.match_stage
      AND m.kickoff_at <= now()
    LIMIT 1
  )
);