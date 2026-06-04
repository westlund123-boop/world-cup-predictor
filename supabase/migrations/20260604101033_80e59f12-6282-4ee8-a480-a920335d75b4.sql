
-- Enum: roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Enum: match stage
CREATE TYPE public.match_stage AS ENUM ('group','r32','r16','qf','sf','third','final');

-- Enum: match status
CREATE TYPE public.match_status AS ENUM ('scheduled','live','finished');

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- handle_new_user trigger: create profile + assign role (admin if matching email)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, department, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'department',
    NEW.raw_user_meta_data->>'avatar_url'
  );

  IF lower(NEW.email) = 'westlund123@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  flag_emoji TEXT,
  group_letter TEXT
);
GRANT SELECT ON public.teams TO authenticated, anon;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams public read" ON public.teams FOR SELECT USING (true);
CREATE POLICY "admins manage teams" ON public.teams FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- players
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT
);
GRANT SELECT ON public.players TO authenticated, anon;
GRANT ALL ON public.players TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players public read" ON public.players FOR SELECT USING (true);
CREATE POLICY "admins manage players" ON public.players FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- matches
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage public.match_stage NOT NULL,
  group_letter TEXT,
  home_team_id UUID REFERENCES public.teams(id),
  away_team_id UUID REFERENCES public.teams(id),
  kickoff_at TIMESTAMPTZ NOT NULL,
  status public.match_status NOT NULL DEFAULT 'scheduled',
  home_score INT,
  away_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.matches TO authenticated, anon;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches public read" ON public.matches FOR SELECT USING (true);
CREATE POLICY "admins manage matches" ON public.matches FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- match_goalscorers (actual)
CREATE TABLE public.match_goalscorers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  is_first BOOLEAN NOT NULL DEFAULT false,
  ord INT NOT NULL DEFAULT 0
);
GRANT SELECT ON public.match_goalscorers TO authenticated, anon;
GRANT ALL ON public.match_goalscorers TO service_role;
ALTER TABLE public.match_goalscorers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scorers public read" ON public.match_goalscorers FOR SELECT USING (true);
CREATE POLICY "admins manage scorers" ON public.match_goalscorers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- predictions
CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('1','X','2')),
  home_score INT NOT NULL CHECK (home_score >= 0 AND home_score <= 20),
  away_score INT NOT NULL CHECK (away_score >= 0 AND away_score <= 20),
  first_scorer_player_id UUID REFERENCES public.players(id),
  points INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, match_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.predictions TO authenticated;
GRANT ALL ON public.predictions TO service_role;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "predictions readable by authenticated" ON public.predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "users insert own predictions" ON public.predictions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own predictions" ON public.predictions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own predictions" ON public.predictions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins manage predictions" ON public.predictions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- prediction_scorers (predicted goalscorers)
CREATE TABLE public.prediction_scorers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  UNIQUE(prediction_id, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prediction_scorers TO authenticated;
GRANT ALL ON public.prediction_scorers TO service_role;
ALTER TABLE public.prediction_scorers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prediction_scorers readable by authenticated" ON public.prediction_scorers FOR SELECT TO authenticated USING (true);
CREATE POLICY "users manage own prediction_scorers" ON public.prediction_scorers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.predictions p WHERE p.id = prediction_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.predictions p WHERE p.id = prediction_id AND p.user_id = auth.uid()));

-- top3 predictions
CREATE TABLE public.top3_predictions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  winner_team_id UUID NOT NULL REFERENCES public.teams(id),
  runner_up_team_id UUID NOT NULL REFERENCES public.teams(id),
  third_team_id UUID NOT NULL REFERENCES public.teams(id),
  points INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.top3_predictions TO authenticated;
GRANT ALL ON public.top3_predictions TO service_role;
ALTER TABLE public.top3_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "top3 readable by authenticated" ON public.top3_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "users manage own top3" ON public.top3_predictions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER predictions_touch BEFORE UPDATE ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER top3_touch BEFORE UPDATE ON public.top3_predictions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Server-side lock enforcement: prevent prediction writes after kickoff
CREATE OR REPLACE FUNCTION public.enforce_prediction_lock() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ko TIMESTAMPTZ;
BEGIN
  IF public.has_role(auth.uid(),'admin') THEN RETURN NEW; END IF;
  SELECT kickoff_at INTO ko FROM public.matches WHERE id = NEW.match_id;
  IF ko IS NULL THEN RAISE EXCEPTION 'match not found'; END IF;
  IF now() >= ko THEN RAISE EXCEPTION 'Predictions are locked for this match'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER predictions_lock_ins BEFORE INSERT ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_lock();
CREATE TRIGGER predictions_lock_upd BEFORE UPDATE ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_lock();
