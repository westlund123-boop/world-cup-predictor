CREATE OR REPLACE FUNCTION public.auto_advance_bracket()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  w_token text;
  l_token text;
  loser uuid;
BEGIN
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.bracket_code IS NULL THEN RETURN NEW; END IF;
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN RETURN NEW; END IF;
  IF NEW.home_team_id IS NULL OR NEW.away_team_id IS NULL THEN RETURN NEW; END IF;

  -- Validate any explicitly provided winner
  IF NEW.winner_team_id IS NOT NULL
     AND NEW.winner_team_id <> NEW.home_team_id
     AND NEW.winner_team_id <> NEW.away_team_id THEN
    RAISE EXCEPTION 'winner_team_id must equal home_team_id or away_team_id';
  END IF;

  -- Derive winner from score when admin did not set one explicitly
  IF NEW.winner_team_id IS NULL THEN
    IF NEW.home_score > NEW.away_score THEN
      NEW.winner_team_id := NEW.home_team_id;
    ELSIF NEW.away_score > NEW.home_score THEN
      NEW.winner_team_id := NEW.away_team_id;
    ELSE
      -- Tied knockout match with no explicit winner: do not advance
      NEW.winner_team_id := NULL;
    END IF;
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

  loser := CASE WHEN NEW.winner_team_id = NEW.home_team_id
                THEN NEW.away_team_id ELSE NEW.home_team_id END;
  UPDATE public.matches SET home_team_id = loser
    WHERE home_source_code = l_token AND home_team_id IS NULL;
  UPDATE public.matches SET away_team_id = loser
    WHERE away_source_code = l_token AND away_team_id IS NULL;

  RETURN NEW;
END $function$;