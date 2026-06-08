
-- 1) Predictions delete: split admin vs user paths
DROP POLICY IF EXISTS "users delete own predictions before kickoff" ON public.predictions;

CREATE POLICY "users delete own predictions before kickoff"
ON public.predictions
FOR DELETE
USING (
  auth.uid() = user_id
  AND NOT private.has_role(auth.uid(), 'admin'::public.app_role)
  AND NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = predictions.match_id AND m.kickoff_at <= now()
  )
);

-- Admins are already covered by the existing "admins manage predictions" ALL policy.

-- 2) Top scorer visibility: only reveal others' picks after first knockout kickoff
DROP POLICY IF EXISTS "top scorer select" ON public.top_scorer_predictions;
CREATE POLICY "top scorer select"
ON public.top_scorer_predictions
FOR SELECT
USING (
  user_id = auth.uid()
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.bracket_code IS NOT NULL AND m.kickoff_at <= now()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "top scorer picks select" ON public.top_scorer_prediction_picks;
CREATE POLICY "top scorer picks select"
ON public.top_scorer_prediction_picks
FOR SELECT
USING (
  user_id = auth.uid()
  OR private.has_role(auth.uid(), 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.bracket_code IS NOT NULL AND m.kickoff_at <= now()
    LIMIT 1
  )
);
