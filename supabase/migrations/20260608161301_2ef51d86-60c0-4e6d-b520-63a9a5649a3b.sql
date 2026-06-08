
-- 1 & 3: Lock down user_roles writes (defense in depth; no permissive write policies exist,
-- but add explicit restrictive policies so the scanner sees writes are forbidden).
CREATE POLICY "no user inserts on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no user updates on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "no user deletes on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 2: Leaderboard cache — authenticated can only read; writes are service_role only.
CREATE POLICY "no user inserts on leaderboard_cache"
  ON public.leaderboard_cache AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no user updates on leaderboard_cache"
  ON public.leaderboard_cache AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "no user deletes on leaderboard_cache"
  ON public.leaderboard_cache AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 4: Consolidate top_scorer_predictions policies — split SELECT (own/admin/post-kickoff)
-- from write policies (own row only; trigger enforce_top_scorer_lock blocks post-kickoff writes).
DROP POLICY IF EXISTS "users manage own top scorer prediction" ON public.top_scorer_predictions;
DROP POLICY IF EXISTS "top scorer read own or after first kickoff" ON public.top_scorer_predictions;

CREATE POLICY "top scorer select"
  ON public.top_scorer_predictions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.matches m WHERE m.kickoff_at <= now() LIMIT 1)
  );
CREATE POLICY "top scorer insert own"
  ON public.top_scorer_predictions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "top scorer update own"
  ON public.top_scorer_predictions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "top scorer delete own"
  ON public.top_scorer_predictions FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

-- Same for top_scorer_prediction_picks.
DROP POLICY IF EXISTS "users manage own top scorer picks" ON public.top_scorer_prediction_picks;
DROP POLICY IF EXISTS "top scorer picks read own or after first kickoff" ON public.top_scorer_prediction_picks;

CREATE POLICY "top scorer picks select"
  ON public.top_scorer_prediction_picks FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.matches m WHERE m.kickoff_at <= now() LIMIT 1)
  );
CREATE POLICY "top scorer picks insert own"
  ON public.top_scorer_prediction_picks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "top scorer picks update own"
  ON public.top_scorer_prediction_picks FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "top scorer picks delete own"
  ON public.top_scorer_prediction_picks FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
