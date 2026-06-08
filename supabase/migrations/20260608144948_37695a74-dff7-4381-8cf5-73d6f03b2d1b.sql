
-- Top Scorer League: parent row per user
CREATE TABLE public.top_scorer_predictions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.top_scorer_predictions TO authenticated;
GRANT ALL ON public.top_scorer_predictions TO service_role;

ALTER TABLE public.top_scorer_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own top scorer prediction"
  ON public.top_scorer_predictions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "top scorer read own or after first kickoff"
  ON public.top_scorer_predictions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.kickoff_at <= now()
      LIMIT 1
    )
  );

CREATE TRIGGER trg_top_scorer_predictions_updated_at
  BEFORE UPDATE ON public.top_scorer_predictions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ordered picks (rank 1..10) per user
CREATE TABLE public.top_scorer_prediction_picks (
  user_id uuid NOT NULL REFERENCES public.top_scorer_predictions(user_id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 10),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, rank),
  UNIQUE (user_id, player_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.top_scorer_prediction_picks TO authenticated;
GRANT ALL ON public.top_scorer_prediction_picks TO service_role;

ALTER TABLE public.top_scorer_prediction_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own top scorer picks"
  ON public.top_scorer_prediction_picks
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "top scorer picks read own or after first kickoff"
  ON public.top_scorer_prediction_picks
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.kickoff_at <= now()
      LIMIT 1
    )
  );

-- Leaderboard cache: add column for new game mode
ALTER TABLE public.leaderboard_cache
  ADD COLUMN IF NOT EXISTS top_scorer_points integer NOT NULL DEFAULT 0;
