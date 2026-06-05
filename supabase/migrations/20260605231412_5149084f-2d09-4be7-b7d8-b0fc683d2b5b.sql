
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS name_on_shirt text,
  ADD COLUMN IF NOT EXISTS shirt_number integer,
  ADD COLUMN IF NOT EXISTS club text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Prevent duplicate active shirt numbers per team
CREATE UNIQUE INDEX IF NOT EXISTS players_team_shirt_active_uniq
  ON public.players (team_id, shirt_number)
  WHERE active = true AND shirt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS players_team_active_idx
  ON public.players (team_id, active);
