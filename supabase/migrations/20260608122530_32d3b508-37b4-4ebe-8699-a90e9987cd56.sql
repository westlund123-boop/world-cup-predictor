
-- Replace permissive read policies with kickoff-gated visibility.

-- predictions
DROP POLICY IF EXISTS "predictions readable by authenticated" ON public.predictions;
CREATE POLICY "predictions read own or after kickoff" ON public.predictions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = predictions.match_id
        AND m.kickoff_at <= now()
    )
  );

-- prediction_scorers (visibility follows the parent prediction)
DROP POLICY IF EXISTS "prediction_scorers readable by authenticated" ON public.prediction_scorers;
CREATE POLICY "prediction_scorers read own or after kickoff" ON public.prediction_scorers
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.predictions p
      LEFT JOIN public.matches m ON m.id = p.match_id
      WHERE p.id = prediction_scorers.prediction_id
        AND (p.user_id = auth.uid() OR (m.kickoff_at IS NOT NULL AND m.kickoff_at <= now()))
    )
  );

-- top3_predictions: lock until first knockout match has started
DROP POLICY IF EXISTS "top3 readable by authenticated" ON public.top3_predictions;
CREATE POLICY "top3 read own or after ko start" ON public.top3_predictions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.stage <> 'group'
        AND m.kickoff_at <= now()
      LIMIT 1
    )
  );
