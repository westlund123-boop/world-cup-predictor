import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import {
  getMatches,
  getTeams,
  getPlayers,
  getMyPredictions,
} from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAGE_LABEL, matchStatus } from "@/lib/scoring";
import { CheckCircle2, Clock, Lock, Pencil } from "lucide-react";
import { TeamFlag } from "@/components/TeamFlag";

export const Route = createFileRoute("/_authenticated/my-predictions")({
  head: () => ({ meta: [{ title: "My predictions — WC 2026 Predictor" }] }),
  component: MyPredictionsPage,
});

const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "third", "final"];

function MyPredictionsPage() {
  const mFn = useServerFn(getMatches);
  const tFn = useServerFn(getTeams);
  const pFn = useServerFn(getPlayers);
  const myFn = useServerFn(getMyPredictions);

  const { data: matches = [], isLoading: lm } = useQuery({ queryKey: ["matches"], queryFn: () => mFn() });
  const { data: teams = [], isLoading: lt } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: players = [], isLoading: lp } = useQuery({ queryKey: ["players"], queryFn: () => pFn() });
  const { data: myPreds, isLoading: lmp } = useQuery({ queryKey: ["myPredictions"], queryFn: () => myFn() });

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const predByMatch = useMemo(
    () => new Map((myPreds?.predictions ?? []).map((p) => [p.match_id, p])),
    [myPreds]
  );
  const scorersByPred = useMemo(() => {
    const m = new Map<string, string[]>();
    (myPreds?.scorers ?? []).forEach((s) => {
      const arr = m.get(s.prediction_id) ?? [];
      arr.push(s.player_id);
      m.set(s.prediction_id, arr);
    });
    return m;
  }, [myPreds]);

  if (lm || lt || lp || lmp) {
    return <div className="text-muted-foreground text-sm">Loading your predictions…</div>;
  }

  const preds = myPreds?.predictions ?? [];

  if (preds.length === 0) {
    return (
      <Card className="p-10 text-center">
        <h1 className="text-2xl font-bold">No predictions yet</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Head to the Matches page and pick your scores before kickoff.
        </p>
        <Button asChild className="mt-5">
          <Link to="/matches">Make a prediction</Link>
        </Button>
      </Card>
    );
  }

  const totalPoints = preds.reduce((s, p) => s + (p.points ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My predictions</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {preds.length} submitted · {totalPoints} pts from match predictions
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/matches">Make more</Link>
        </Button>
      </header>

      {STAGE_ORDER.map((stage) => {
        const list = preds
          .map((p) => ({ pred: p, match: matches.find((m) => m.id === p.match_id) }))
          .filter((x) => x.match && x.match.stage === stage)
          .sort((a, b) => a.match!.kickoff_at.localeCompare(b.match!.kickoff_at));
        if (list.length === 0) return null;
        return (
          <section key={stage} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {STAGE_LABEL[stage]}
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {list.map(({ pred, match }) => {
                const home = match!.home_team_id ? teamMap.get(match!.home_team_id) : undefined;
                const away = match!.away_team_id ? teamMap.get(match!.away_team_id) : undefined;
                const st = matchStatus(match!.kickoff_at, match!.status);
                const scorerIds = scorersByPred.get(pred.id) ?? [];
                const firstScorer = pred.first_scorer_player_id ? playerMap.get(pred.first_scorer_player_id) : null;
                const otherScorers = scorerIds
                  .filter((id) => id !== pred.first_scorer_player_id)
                  .map((id) => playerMap.get(id))
                  .filter(Boolean);

                return (
                  <Card key={pred.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {new Date(match!.kickoff_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      <StateBadge status={st} />
                    </div>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="flex items-center gap-2 justify-end text-right">
                        <span className="font-semibold text-sm">{home?.name ?? "TBD"}</span>
                        <TeamFlag code={home?.code} name={home?.name} size="lg" />
                      </div>
                      <div className="font-mono text-lg font-bold text-primary">
                        {pred.home_score}–{pred.away_score}
                      </div>
                      <div className="flex items-center gap-2">
                        <TeamFlag code={away?.code} name={away?.name} size="lg" />
                        <span className="font-semibold text-sm">{away?.name ?? "TBD"}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">
                        Outcome: {pred.outcome === "1" ? home?.code : pred.outcome === "2" ? away?.code : "Draw"}
                      </Badge>
                      {st === "finished" && match!.home_score !== null && (
                        <Badge variant="secondary">
                          Result {match!.home_score}–{match!.away_score} · {pred.points} pts
                        </Badge>
                      )}
                    </div>

                    {firstScorer && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">First scorer: </span>
                        <span className="font-medium">{firstScorer.name}</span>
                      </div>
                    )}
                    {otherScorers.length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Other scorers: </span>
                        <span>{otherScorers.map((p) => p!.name).join(", ")}</span>
                      </div>
                    )}

                    {st === "open" && (
                      <Button asChild size="sm" variant="ghost" className="w-full">
                        <Link to="/matches">
                          <Pencil className="h-3 w-3 mr-1" /> Edit on Matches
                        </Link>
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StateBadge({ status }: { status: "open" | "locked" | "finished" }) {
  if (status === "open") return <span className="inline-flex items-center gap-1 text-primary font-medium"><Clock className="h-3 w-3" />Editable</span>;
  if (status === "locked") return <span className="inline-flex items-center gap-1 text-muted-foreground font-medium"><Lock className="h-3 w-3" />Locked</span>;
  return <span className="inline-flex items-center gap-1 text-foreground font-medium"><CheckCircle2 className="h-3 w-3" />Finished</span>;
}
