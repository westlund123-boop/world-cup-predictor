CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
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

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

DROP POLICY IF EXISTS "admins manage teams" ON public.teams;
CREATE POLICY "admins manage teams"
ON public.teams
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage players" ON public.players;
CREATE POLICY "admins manage players"
ON public.players
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage matches" ON public.matches;
CREATE POLICY "admins manage matches"
ON public.matches
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert matches" ON public.matches;
CREATE POLICY "Admins can insert matches"
ON public.matches
FOR INSERT
TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update matches" ON public.matches;
CREATE POLICY "Admins can update matches"
ON public.matches
FOR UPDATE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage scorers" ON public.match_goalscorers;
CREATE POLICY "admins manage scorers"
ON public.match_goalscorers
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage match_goalscorers" ON public.match_goalscorers;
CREATE POLICY "Admins manage match_goalscorers"
ON public.match_goalscorers
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage predictions" ON public.predictions;
CREATE POLICY "admins manage predictions"
ON public.predictions
FOR ALL
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "predictions read own or after kickoff" ON public.predictions;
CREATE POLICY "predictions read own or after kickoff"
ON public.predictions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = predictions.match_id
      AND m.kickoff_at <= now()
  )
);

DROP POLICY IF EXISTS "prediction_scorers read own or after kickoff" ON public.prediction_scorers;
CREATE POLICY "prediction_scorers read own or after kickoff"
ON public.prediction_scorers
FOR SELECT
TO authenticated
USING (
  private.has_role(auth.uid(), 'admin'::public.app_role)
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

DROP POLICY IF EXISTS "top3 read own or after ko start" ON public.top3_predictions;
CREATE POLICY "top3 read own or after ko start"
ON public.top3_predictions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.stage <> 'group'::public.match_stage
      AND m.kickoff_at <= now()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "Users delete own; admins delete any" ON public.wall_messages;
CREATE POLICY "Users delete own; admins delete any"
ON public.wall_messages
FOR DELETE
TO authenticated
USING (
  auth.uid() = author_id
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE OR REPLACE FUNCTION public.enforce_prediction_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ko timestamptz;
BEGIN
  IF private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  SELECT kickoff_at INTO ko
  FROM public.matches
  WHERE id = NEW.match_id;

  IF ko IS NULL THEN
    RAISE EXCEPTION 'match not found';
  END IF;

  IF now() >= ko THEN
    RAISE EXCEPTION 'Predictions are locked for this match';
  END IF;

  RETURN NEW;
END;
$$;