CREATE TABLE public.match_previews (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  content text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.match_previews TO authenticated;
GRANT ALL ON public.match_previews TO service_role;

ALTER TABLE public.match_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read match previews"
  ON public.match_previews FOR SELECT
  TO authenticated
  USING (true);
