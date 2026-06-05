import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upsertPrediction } from "@/lib/wc.functions";
import { matchStatus, STAGE_LABEL } from "@/lib/scoring";
import { toast } from "sonner";
import { Lock, CheckCircle2, Clock, Pencil, CircleDashed, Radio, ChevronsUpDown, Check, X } from "lucide-react";

type Team = { id: string; name: string; code: string; flag_emoji: string | null; group_letter: string | null };
type Match = {
  id: string; stage: string; group_letter: string | null; kickoff_at: string; status: string;
  home_score: number | null; away_score: number | null;
  home_team_id: string | null; away_team_id: string | null;
};
type Player = { id: string; team_id: string; name: string; position: string | null };
type Prediction = {
  id: string; match_id: string; outcome: string; home_score: number; away_score: number;
  first_scorer_player_id: string | null; points: number;
};

type PState = "not_predicted" | "saved" | "editing" | "locked" | "live" | "finished";

export function MatchCard({
  match, home, away, players, prediction, scorerIds,
}: {
  match: Match; home: Team; away: Team; players: Player[];
  prediction?: Prediction; scorerIds: string[];
}) {
  const status = matchStatus(match.kickoff_at, match.status);
  const locked = status !== "open";

  const [outcome, setOutcome] = useState<"1" | "X" | "2">((prediction?.outcome as any) ?? "1");
  const [hs, setHs] = useState<number>(prediction?.home_score ?? 1);
  const [as_, setAs] = useState<number>(prediction?.away_score ?? 0);
  const [firstScorer, setFirstScorer] = useState<string | null>(prediction?.first_scorer_player_id ?? null);
  const [scorers, setScorers] = useState<string[]>(scorerIds);
  const [dirty, setDirty] = useState(false);

  const homeSquad = players.filter((p) => p.team_id === home.id);
  const awaySquad = players.filter((p) => p.team_id === away.id);

  const qc = useQueryClient();
  const fn = useServerFn(upsertPrediction);
  const save = useMutation({
    mutationFn: () =>
      fn({
        data: {
          match_id: match.id,
          outcome,
          home_score: hs,
          away_score: as_,
          first_scorer_player_id: firstScorer,
          scorer_ids: scorers,
        },
      }),
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

  const onChange = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

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

        <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-md">
          {(["1", "X", "2"] as const).map((opt) => (
            <button
              key={opt}
              disabled={locked}
              onClick={() => onChange(setOutcome)(opt)}
              className={`py-2 rounded text-sm font-semibold transition-colors ${
                outcome === opt ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {opt === "1" ? `${home.code} win` : opt === "X" ? "Draw" : `${away.code} win`}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3">
          <ScoreInput value={hs} onChange={onChange(setHs)} disabled={locked} label={home.code} />
          <span className="text-xl text-muted-foreground font-mono">–</span>
          <ScoreInput value={as_} onChange={onChange(setAs)} disabled={locked} label={away.code} />
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">First goalscorer (+4 pts)</Label>
          <select
            disabled={locked}
            value={firstScorer ?? ""}
            onChange={(e) => onChange(setFirstScorer)(e.target.value || null)}
            className="mt-1.5 w-full h-9 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-60"
          >
            <option value="">No prediction</option>
            <optgroup label={home.name}>
              {homeSquad.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position})</option>)}
            </optgroup>
            <optgroup label={away.name}>
              {awaySquad.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position})</option>)}
            </optgroup>
          </select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Other goalscorers (2 pts each, max 8)</Label>
          <div className="grid grid-cols-2 gap-3 max-h-44 overflow-y-auto pr-1">
            <ScorerCol title={home.name} players={homeSquad} selected={scorers} setSelected={onChange(setScorers)} disabled={locked} excludeId={firstScorer} />
            <ScorerCol title={away.name} players={awaySquad} selected={scorers} setSelected={onChange(setScorers)} disabled={locked} excludeId={firstScorer} />
          </div>
        </div>

        {status === "finished" && prediction && (
          <div className="text-center py-2 rounded-md bg-accent text-accent-foreground font-semibold">
            You earned {prediction.points} pts
          </div>
        )}

        {!locked && (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (!dirty && !!prediction)}
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
      <span className="text-3xl leading-none">{team.flag_emoji}</span>
      <div className={align === "right" ? "text-right" : ""}>
        <div className="font-semibold leading-tight">{team.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{team.code}</div>
      </div>
    </div>
  );
}

function ScoreInput({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <Input
        type="number"
        min={0}
        max={20}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.min(20, parseInt(e.target.value || "0", 10))))}
        className="w-16 text-center text-xl font-bold font-mono h-12"
      />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

function ScorerCol({
  title, players, selected, setSelected, disabled, excludeId,
}: {
  title: string; players: Player[]; selected: string[]; setSelected: (v: string[]) => void;
  disabled: boolean; excludeId: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-semibold mb-1.5">{title}</div>
      <div className="space-y-1">
        {players.filter((p) => p.id !== excludeId).map((p) => {
          const checked = selected.includes(p.id);
          return (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => {
                  if (v) setSelected([...selected, p.id]);
                  else setSelected(selected.filter((x) => x !== p.id));
                }}
              />
              <span>{p.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
