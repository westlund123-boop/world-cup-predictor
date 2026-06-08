CREATE TABLE public.wall_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wall_messages_created_at_idx ON public.wall_messages (created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.wall_messages TO authenticated;
GRANT ALL ON public.wall_messages TO service_role;

ALTER TABLE public.wall_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read all wall messages"
  ON public.wall_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can post their own wall messages"
  ON public.wall_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users delete own; admins delete any"
  ON public.wall_messages FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'));