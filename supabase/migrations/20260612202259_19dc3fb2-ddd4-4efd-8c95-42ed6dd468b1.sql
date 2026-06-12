CREATE TABLE public.team_form (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  last10_results text,
  wins int,
  draws int,
  losses int,
  goals_for int,
  goals_against int,
  top_scorers jsonb,
  source text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.team_form TO authenticated;
GRANT ALL ON public.team_form TO service_role;
ALTER TABLE public.team_form ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read team form"
  ON public.team_form FOR SELECT TO authenticated USING (true);