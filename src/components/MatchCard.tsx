import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertPrediction, getMyProfile } from "@/lib/wc.functions";
import { getMatchPreview, ensureMatchPreview, regenerateMatchPreview } from "@/lib/match-preview.functions";
import { matchStatus, STAGE_LABEL, outcomeOf } from "@/lib/scoring";
import { toast } from "sonner";
import { Lock, CheckCircle2, Pencil, CircleDashed, Radio, ChevronsUpDown, Check, X, AlertTriangle, Sparkles, ChevronDown, RefreshCw, Loader2 } from "lucide-react";
import { TeamFlag } from "@/components/TeamFlag";
import ReactMarkdown from "react-markdown";

type Team = { id: string; name: string; code: string; flag_emoji: string | null; group_letter: string | null };
type Match = {
  id: string; stage: string; group_letter: string | null; kickoff_at: string; status: string;
  home_score: number | null; away_score: number | null;
  home_team_id: string | null; away_team_id: string | null;
};
type Player = { id: string; team_id: string; name: string; position: string | null; shirt_number?: number | null; name_on_shirt?: string | null; club?: string | null };
type Prediction = {
  id: string; match_id: string; outcome: string; home_score: number; away_score: number;
  first_scorer_player_id: string | null; points: number;
  needs_repick?: boolean | null;
};

type PState = "not_predicted" | "saved" | "editing" | "locked" | "live" | "finished";

const SCORE_OPTIONS = Array.from({ length: 11 }, (_, i) => i); // 0..10

export function MatchCard({
  match, home, away, players, prediction, scorerIds,
}: {
  match: Match; home: Team; away: Team; players: Player[];
  prediction?: Prediction; scorerIds: string[];
}) {
  const status = matchStatus(match.kickoff_at, match.status);
  const locked = status !== "open";

  // No silent default any more — null until user picks.
  const [outcome, setOutcome] = useState<"1" | "X" | "2" | null>((prediction?.outcome as any) ?? null);
  const [hs, setHs] = useState<number | null>(prediction?.home_score ?? null);
  const [as_, setAs] = useState<number | null>(prediction?.away_score ?? null);
  const [firstScorer, setFirstScorer] = useState<string | null>(prediction?.first_scorer_player_id ?? null);
  // Single other scorer only.
  const [otherScorer, setOtherScorer] = useState<string | null>(scorerIds[0] ?? null);
  const [dirty, setDirty] = useState(false);

  const homeSquad = players.filter((p) => p.team_id === home.id);
  const awaySquad = players.filter((p) => p.team_id === away.id);

  const qc = useQueryClient();
  const fn = useServerFn(upsertPrediction);
  const save = useMutation({
    mutationFn: () => {
      if (hs == null || as_ == null || !outcome) {
        throw new Error("Pick a score and outcome first");
      }
      return fn({
        data: {
          match_id: match.id,
          outcome,
          home_score: hs,
          away_score: as_,
          first_scorer_player_id: firstScorer,
          scorer_ids: otherScorer ? [otherScorer] : [],
        },
      });
    },
    onSuccess: () => {
      toast.success("Prediction saved", { description: `${home.name} vs ${away.name}` });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["myPredictions"] });
      qc.invalidateQueries({ queryKey: ["leaderboard-cache"] });
    },
    onError: (e: Error) => toast.error("Could not save prediction", { description: e.message }),
  });

  // Live clock refresh so "locked at kickoff" hits as soon as time passes
  const [, setTick] = useState(0);
  useEffect(() => {
    if (locked) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [locked]);

  const pState: PState =
    status === "finished" ? "finished"
    : status === "locked" ? (match.status === "live" ? "live" : "locked")
    : prediction ? (dirty ? "editing" : "saved")
    : "not_predicted";

  const kickoff = useMemo(() => new Date(match.kickoff_at), [match.kickoff_at]);

  const showRepickNotice = !locked && !!prediction?.needs_repick && !dirty;

  // Auto-sync 1X2 toggle from the score when the user changes the score.
  const setHomeScore = (n: number) => {
    setHs(n); setDirty(true);
    if (as_ != null) setOutcome(outcomeOf(n, as_));
  };
  const setAwayScore = (n: number) => {
    setAs(n); setDirty(true);
    if (hs != null) setOutcome(outcomeOf(hs, n));
  };

  const canSave = !locked && hs != null && as_ != null && !!outcome && (dirty || !prediction);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-muted/40 border-b border-border text-xs gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="font-normal whitespace-nowrap">
            {STAGE_LABEL[match.stage] ?? match.stage}
            {match.group_letter ? ` · ${match.group_letter}` : ""}
          </Badge>
          <span className="text-muted-foreground truncate">
            {kickoff.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
        <PredictionStateBadge state={pState} />
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamSide team={home} align="right" />
          <div className="text-center">
            {status === "finished" ? (
              <div className="font-mono font-bold text-2xl">
                {match.home_score} – {match.away_score}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground uppercase tracking-wider">vs</div>
            )}
          </div>
          <TeamSide team={away} align="left" />
        </div>

        {locked && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            {status === "finished"
              ? "Match finished — your prediction is final."
              : match.status === "live"
              ? "Match in progress — predictions are locked."
              : "This match has already started, predictions are locked."}
          </div>
        )}

        {showRepickNotice && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Rules updated — only ONE other goalscorer is allowed now. Please re-pick your goalscorer and save.</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-md">
          {(["1", "X", "2"] as const).map((opt) => (
            <button
              key={opt}
              disabled={locked}
              onClick={() => { setOutcome(opt); setDirty(true); }}
              className={`py-2 rounded text-sm font-semibold transition-colors ${
                outcome === opt ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {opt === "1" ? `${home.code} win` : opt === "X" ? "Draw" : `${away.code} win`}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-center gap-3">
          <ScoreSelect value={hs} onChange={setHomeScore} disabled={locked} label={home.code} />
          <span className="text-xl text-muted-foreground font-mono pb-3">–</span>
          <ScoreSelect value={as_} onChange={setAwayScore} disabled={locked} label={away.code} />
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">First goalscorer (+10 pts)</Label>
          <PlayerCombobox
            disabled={locked}
            value={firstScorer}
            onChange={(v) => { setFirstScorer(v); setDirty(true); }}
            home={home}
            away={away}
            homeSquad={homeSquad}
            awaySquad={awaySquad}
            placeholder="Pick first scorer…"
          />
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Other goalscorer (5 pts)</Label>
          <PlayerCombobox
            disabled={locked}
            value={otherScorer}
            onChange={(v) => { setOtherScorer(v); setDirty(true); }}
            home={home}
            away={away}
            homeSquad={homeSquad}
            awaySquad={awaySquad}
            placeholder="Pick one other scorer…"
            excludeId={firstScorer}
          />
        </div>

        {status === "finished" && prediction && (
          <div className="text-center py-2 rounded-md bg-accent text-accent-foreground font-semibold">
            You earned {prediction.points} pts
          </div>
        )}

        {!locked && (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !canSave}
            className="w-full"
          >
            {save.isPending
              ? "Saving…"
              : prediction
              ? dirty ? "Update prediction" : "Saved"
              : "Save prediction"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function PredictionStateBadge({ state }: { state: PState }) {
  const map = {
    not_predicted: { icon: CircleDashed, label: "Not predicted", cls: "text-muted-foreground" },
    saved:         { icon: CheckCircle2, label: "Saved",         cls: "text-primary" },
    editing:       { icon: Pencil,       label: "Unsaved edits", cls: "text-amber-600" },
    locked:        { icon: Lock,         label: "Locked",        cls: "text-muted-foreground" },
    live:          { icon: Radio,        label: "Live",          cls: "text-destructive" },
    finished:      { icon: CheckCircle2, label: "Finished",      cls: "text-foreground" },
  } as const;
  const { icon: Icon, label, cls } = map[state];
  return (
    <span className={`inline-flex items-center gap-1 font-medium whitespace-nowrap ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  );
}

function TeamSide({ team, align }: { team: Team; align: "left" | "right" }) {
  return (
    <div className={`flex items-center gap-2 ${align === "right" ? "justify-end flex-row-reverse" : "justify-start"}`}>
      <TeamFlag code={team.code} name={team.name} size="xl" />
      <div className={align === "right" ? "text-right" : ""}>
        <div className="font-semibold leading-tight">{team.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{team.code}</div>
      </div>
    </div>
  );
}

function ScoreSelect({
  value, onChange, disabled, label,
}: { value: number | null; onChange: (n: number) => void; disabled: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <Select
        value={value == null ? "" : String(value)}
        onValueChange={(v) => onChange(parseInt(v, 10))}
        disabled={disabled}
      >
        <SelectTrigger className="w-20 h-12 text-xl font-bold font-mono justify-center">
          <SelectValue placeholder="–" />
        </SelectTrigger>
        <SelectContent className="min-w-[5rem]">
          {SCORE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)} className="justify-center text-base font-mono">
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

function formatPlayer(p: Player, teamCode: string) {
  const num = p.shirt_number != null ? `#${p.shirt_number} ` : "";
  const pos = p.position ? ` · ${p.position}` : "";
  return `${num}${p.name}${pos} · ${teamCode}`;
}

function PlayerCombobox({
  value, onChange, disabled, home, away, homeSquad, awaySquad, placeholder, excludeId,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
  home: Team; away: Team;
  homeSquad: Player[]; awaySquad: Player[];
  placeholder: string;
  excludeId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const homeFiltered = useMemo(
    () => homeSquad.filter((p) => p.id !== excludeId),
    [homeSquad, excludeId],
  );
  const awayFiltered = useMemo(
    () => awaySquad.filter((p) => p.id !== excludeId),
    [awaySquad, excludeId],
  );
  const all = useMemo(() => [
    ...homeFiltered.map((p) => ({ p, team: home })),
    ...awayFiltered.map((p) => ({ p, team: away })),
  ], [homeFiltered, awayFiltered, home, away]);
  const selected = all.find((x) => x.p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="mt-1.5 w-full justify-between font-normal h-9 text-sm"
        >
          <span className="truncate">
            {selected ? (
              <>
                <span className="text-base mr-1.5">{selected.team.flag_emoji}</span>
                {formatPlayer(selected.p, selected.team.code)}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search player or number…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No players found.</CommandEmpty>
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5 mr-2" /> Clear selection
                </CommandItem>
              </CommandGroup>
            )}
            {[{ team: home, squad: homeFiltered }, { team: away, squad: awayFiltered }].map(({ team, squad }) => (
              <CommandGroup key={team.id} heading={`${team.flag_emoji ?? ""} ${team.name}`}>
                {squad.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.shirt_number ?? ""} ${p.name} ${p.position ?? ""} ${team.code}`}
                    onSelect={() => { onChange(p.id); setOpen(false); }}
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 ${value === p.id ? "opacity-100" : "opacity-0"}`} />
                    <span className="font-mono text-xs text-muted-foreground w-7">
                      {p.shirt_number != null ? `#${p.shirt_number}` : ""}
                    </span>
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.position && <span className="text-xs text-muted-foreground ml-2">{p.position}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
