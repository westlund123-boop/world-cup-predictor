DROP TRIGGER IF EXISTS trg_auto_advance ON public.matches;
CREATE TRIGGER trg_auto_advance
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.auto_advance_bracket();