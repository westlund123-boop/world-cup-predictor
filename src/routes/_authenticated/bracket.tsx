import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getMatches, getTeams, getMyPredictions } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { matchStatus, STAGE_LABEL, predictedWinner } from "@/lib/scoring";
import { Lock, CheckCircle2, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bracket")({
  head: () => ({ meta: [{ title: "Knockout bracket — WC 2026 Predictor" }] }),
  component: BracketPage,
});

const COLUMNS: { stage: string; label: string }[] = [
  { stage: "r32", label: "Round of 32" },
  { stage: "r16", label: "Round of 16" },
  { stage: "qf", label: "Quarter-finals" },
  { stage: "sf", label: "Semi-finals" },
  { stage: "final", label: "Final" },
];

function BracketPage() {
  const mFn = useServerFn(getMatches);
  const tFn = useServerFn(getTeams);
  const myFn = useServerFn(getMyPredictions);

  const { data: matches = [] } = useQuery({ queryKey: ["matches"], queryFn: () => mFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: myPreds } = useQuery({ queryKey: ["myPredictions"], queryFn: () => myFn() });

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const predMap = useMemo(
    () => new Map((myPreds?.predictions ?? []).map((p) => [p.match_id, p])),
    [myPreds]
  );

  const thirdMatch = matches.find((m) => m.stage === "third");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Knockout bracket</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Winners advance automatically as results are entered. Your predicted winner is shown in
          orange.
        </p>
      </header>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-[1100px] lg:min-w-0">
          {COLUMNS.map((col) => {
            const list = matches
              .filter((m) => m.stage === col.stage)
              .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
            return (
              <div key={col.stage} className="flex-1 min-w-[210px] space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center sticky top-16 bg-background py-1">
                  {col.label}
                </div>
                <div
                  className="flex flex-col"
                  style={{ gap: col.stage === "final" ? "0" : col.stage === "sf" ? "8rem" : col.stage === "qf" ? "4rem" : col.stage === "r16" ? "2rem" : "1rem" }}
                >
                  {list.map((m) => (
                    <BracketMatchCard
                      key={m.id}
                      match={m}
                      home={m.home_team_id ? teamMap.get(m.home_team_id) : undefined}
                      away={m.away_team_id ? teamMap.get(m.away_team_id) : undefined}
                      myPred={predMap.get(m.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {thirdMatch && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Third-place match
          </h2>
          <div className="max-w-md">
            <BracketMatchCard
              match={thirdMatch}
              home={thirdMatch.home_team_id ? teamMap.get(thirdMatch.home_team_id) : undefined}
              away={thirdMatch.away_team_id ? teamMap.get(thirdMatch.away_team_id) : undefined}
              myPred={predMap.get(thirdMatch.id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type T = { id: string; name: string; code: string; flag_emoji: string | null } | undefined;

function BracketMatchCard({
  match,
  home,
  away,
  myPred,
}: {
  match: any;
  home: T;
  away: T;
  myPred?: { outcome: string; home_score: number; away_score: number; points: number };
}) {
  const status = matchStatus(match.kickoff_at, match.status);
  const finished = status === "finished";
  const myWinnerId = myPred ? predictedWinner(myPred, match) : null;
  const actualWinnerId = match.winner_team_id;

  return (
    <Card className="overflow-hidden">
      <div className="px-3 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between text-[10px] uppercase tracking-wider">
        <span className="font-mono text-muted-foreground">{match.bracket_code}</span>
        <StatusPill status={status} />
      </div>
      <div className="divide-y divide-border">
        <TeamRow team={home} placeholder={match.home_source_code} actualWinner={actualWinnerId === home?.id} myPick={myWinnerId === home?.id} />
        <TeamRow team={away} placeholder={match.away_source_code} actualWinner={actualWinnerId === away?.id} myPick={myWinnerId === away?.id} />
      </div>
      <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>
          {new Date(match.kickoff_at).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {finished && match.home_score !== null && (
          <span className="font-mono font-semibold text-foreground">
            {match.home_score}–{match.away_score}
          </span>
        )}
      </div>
      {myPred && finished && (
        <div className="px-3 py-1 text-[10px] text-center bg-accent text-accent-foreground font-semibold">
          You earned {myPred.points} pts
        </div>
      )}
    </Card>
  );
}

function TeamRow({
  team,
  placeholder,
  actualWinner,
  myPick,
}: {
  team: T;
  placeholder?: string | null;
  actualWinner?: boolean;
  myPick?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 text-sm ${
        actualWinner ? "bg-primary/10 font-semibold" : ""
      }`}
    >
      <span className="text-xl leading-none">{team?.flag_emoji ?? "·"}</span>
      <span className={`flex-1 truncate ${team ? "" : "text-muted-foreground italic text-xs"}`}>
        {team?.name ?? (placeholder ? `Winner ${placeholder}` : "TBD")}
      </span>
      {myPick && (
        <Badge variant="outline" className="text-[9px] py-0 h-4 border-primary text-primary">
          My pick
        </Badge>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "open" | "locked" | "finished" }) {
  if (status === "open")
    return (
      <span className="inline-flex items-center gap-1 text-primary">
        <Clock className="h-2.5 w-2.5" />
        Open
      </span>
    );
  if (status === "locked")
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Lock className="h-2.5 w-2.5" />
        Locked
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      <CheckCircle2 className="h-2.5 w-2.5" />
      Done
    </span>
  );
}
