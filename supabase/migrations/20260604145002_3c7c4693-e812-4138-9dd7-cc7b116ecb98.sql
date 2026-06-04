
-- 1) Bracket linkage on matches
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS bracket_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS home_source_code text,
  ADD COLUMN IF NOT EXISTS away_source_code text,
  ADD COLUMN IF NOT EXISTS winner_team_id uuid REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

-- 2) Leaderboard cache (rebuilt by recalc; idempotent)
CREATE TABLE IF NOT EXISTS public.leaderboard_cache (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total int NOT NULL DEFAULT 0,
  match_points int NOT NULL DEFAULT 0,
  goalscorer_points int NOT NULL DEFAULT 0,
  knockout_points int NOT NULL DEFAULT 0,
  top3_points int NOT NULL DEFAULT 0,
  exact_count int NOT NULL DEFAULT 0,
  onextwo_count int NOT NULL DEFAULT 0,
  predictions_made int NOT NULL DEFAULT 0,
  top3_submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.leaderboard_cache TO authenticated;
GRANT ALL ON public.leaderboard_cache TO service_role;
ALTER TABLE public.leaderboard_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leaderboard readable by all authenticated"
  ON public.leaderboard_cache FOR SELECT TO authenticated USING (true);

-- 3) Auto-advance trigger: when a knockout match is marked finished with a winner,
--    fill any later match whose source code references this bracket_code.
CREATE OR REPLACE FUNCTION public.auto_advance_bracket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  w_token text;
  l_token text;
BEGIN
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.bracket_code IS NULL THEN RETURN NEW; END IF;
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN RETURN NEW; END IF;
  IF NEW.home_team_id IS NULL OR NEW.away_team_id IS NULL THEN RETURN NEW; END IF;

  -- Compute winner (KO cannot draw; require strict winner)
  IF NEW.home_score > NEW.away_score THEN
    NEW.winner_team_id := NEW.home_team_id;
  ELSIF NEW.away_score > NEW.home_score THEN
    NEW.winner_team_id := NEW.away_team_id;
  ELSE
    -- Allow draws to persist only outside KO (group). For KO, admin must adjust.
    NEW.winner_team_id := NULL;
  END IF;

  IF NEW.winner_team_id IS NULL THEN RETURN NEW; END IF;

  w_token := 'W:' || NEW.bracket_code;
  l_token := 'L:' || NEW.bracket_code;

  UPDATE public.matches
     SET home_team_id = NEW.winner_team_id
   WHERE home_source_code = w_token AND home_team_id IS NULL;
  UPDATE public.matches
     SET away_team_id = NEW.winner_team_id
   WHERE away_source_code = w_token AND away_team_id IS NULL;

  -- Loser feeds (third-place match)
  DECLARE loser uuid;
  BEGIN
    loser := CASE WHEN NEW.winner_team_id = NEW.home_team_id THEN NEW.away_team_id ELSE NEW.home_team_id END;
    UPDATE public.matches SET home_team_id = loser
      WHERE home_source_code = l_token AND home_team_id IS NULL;
    UPDATE public.matches SET away_team_id = loser
      WHERE away_source_code = l_token AND away_team_id IS NULL;
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_advance ON public.matches;
CREATE TRIGGER trg_auto_advance
BEFORE UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.auto_advance_bracket();

-- 4) Admin write policy on matches (results entry)
DROP POLICY IF EXISTS "Admins can update matches" ON public.matches;
CREATE POLICY "Admins can update matches"
  ON public.matches FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Admins can insert matches" ON public.matches;
CREATE POLICY "Admins can insert matches"
  ON public.matches FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- match_goalscorers admin policies
DROP POLICY IF EXISTS "Admins manage match_goalscorers" ON public.match_goalscorers;
CREATE POLICY "Admins manage match_goalscorers"
  ON public.match_goalscorers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 5) Knockout match seeding (only if not already present)
INSERT INTO public.matches (stage, bracket_code, home_source_code, away_source_code, kickoff_at, status)
SELECT * FROM (VALUES
  -- Round of 32 (16 matches) - sources are group seed labels admin will fulfill
  ('r32'::match_stage, 'R32-1',  '1A','2B', '2026-06-27 17:00:00+00'::timestamptz, 'scheduled'::match_status),
  ('r32','R32-2',  '1C','2D','2026-06-27 21:00:00+00','scheduled'),
  ('r32','R32-3',  '1B','2A','2026-06-28 17:00:00+00','scheduled'),
  ('r32','R32-4',  '1D','2C','2026-06-28 21:00:00+00','scheduled'),
  ('r32','R32-5',  '1E','2F','2026-06-29 17:00:00+00','scheduled'),
  ('r32','R32-6',  '1G','2H','2026-06-29 21:00:00+00','scheduled'),
  ('r32','R32-7',  '1F','2E','2026-06-30 17:00:00+00','scheduled'),
  ('r32','R32-8',  '1H','2G','2026-06-30 21:00:00+00','scheduled'),
  ('r32','R32-9',  '1I','2J','2026-07-01 17:00:00+00','scheduled'),
  ('r32','R32-10', '1K','2L','2026-07-01 21:00:00+00','scheduled'),
  ('r32','R32-11', '1J','2I','2026-07-02 17:00:00+00','scheduled'),
  ('r32','R32-12', '1L','2K','2026-07-02 21:00:00+00','scheduled'),
  ('r32','R32-13', '3A','3B','2026-07-03 17:00:00+00','scheduled'),
  ('r32','R32-14', '3C','3D','2026-07-03 21:00:00+00','scheduled'),
  ('r32','R32-15', '3E','3F','2026-07-04 17:00:00+00','scheduled'),
  ('r32','R32-16', '3G','3H','2026-07-04 21:00:00+00','scheduled'),
  -- Round of 16
  ('r16','R16-1','W:R32-1','W:R32-2','2026-07-06 17:00:00+00','scheduled'),
  ('r16','R16-2','W:R32-3','W:R32-4','2026-07-06 21:00:00+00','scheduled'),
  ('r16','R16-3','W:R32-5','W:R32-6','2026-07-07 17:00:00+00','scheduled'),
  ('r16','R16-4','W:R32-7','W:R32-8','2026-07-07 21:00:00+00','scheduled'),
  ('r16','R16-5','W:R32-9','W:R32-10','2026-07-08 17:00:00+00','scheduled'),
  ('r16','R16-6','W:R32-11','W:R32-12','2026-07-08 21:00:00+00','scheduled'),
  ('r16','R16-7','W:R32-13','W:R32-14','2026-07-09 17:00:00+00','scheduled'),
  ('r16','R16-8','W:R32-15','W:R32-16','2026-07-09 21:00:00+00','scheduled'),
  -- Quarter-finals
  ('qf','QF-1','W:R16-1','W:R16-2','2026-07-11 17:00:00+00','scheduled'),
  ('qf','QF-2','W:R16-3','W:R16-4','2026-07-11 21:00:00+00','scheduled'),
  ('qf','QF-3','W:R16-5','W:R16-6','2026-07-12 17:00:00+00','scheduled'),
  ('qf','QF-4','W:R16-7','W:R16-8','2026-07-12 21:00:00+00','scheduled'),
  -- Semi-finals
  ('sf','SF-1','W:QF-1','W:QF-2','2026-07-14 21:00:00+00','scheduled'),
  ('sf','SF-2','W:QF-3','W:QF-4','2026-07-15 21:00:00+00','scheduled'),
  -- Third place + Final
  ('third','3RD','L:SF-1','L:SF-2','2026-07-18 21:00:00+00','scheduled'),
  ('final','FINAL','W:SF-1','W:SF-2','2026-07-19 20:00:00+00','scheduled')
) AS v(stage, bracket_code, home_source_code, away_source_code, kickoff_at, status)
WHERE NOT EXISTS (SELECT 1 FROM public.matches WHERE bracket_code = v.bracket_code);
