import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getMatches, getTeams, getPlayers, getMyPredictions } from "@/lib/wc.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MatchCard } from "@/components/MatchCard";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/matches")({
  head: () => ({ meta: [{ title: "Matches — WC 2026 Predictor" }] }),
  component: MatchesPage,
});

const STAGES: { value: string; label: string }[] = [
  { value: "group", label: "Group Stage" },
  { value: "r32", label: "Round of 32" },
  { value: "r16", label: "Round of 16" },
  { value: "qf", label: "Quarter-finals" },
  { value: "sf", label: "Semi-finals" },
  { value: "third", label: "3rd place" },
  { value: "final", label: "Final" },
];

function MatchesPage() {
  const mFn = useServerFn(getMatches);
  const tFn = useServerFn(getTeams);
  const pFn = useServerFn(getPlayers);
  const myFn = useServerFn(getMyPredictions);

  const { data: matches = [] } = useQuery({ queryKey: ["matches"], queryFn: () => mFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: players = [] } = useQuery({ queryKey: ["players"], queryFn: () => pFn() });
  const { data: myPreds } = useQuery({ queryKey: ["myPredictions"], queryFn: () => myFn() });

  const [stage, setStage] = useState("group");
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const predMap = useMemo(
    () => new Map((myPreds?.predictions ?? []).map((p) => [p.match_id, p])),
    [myPreds]
  );
  const scorerByPred = useMemo(() => {
    const m = new Map<string, string[]>();
    (myPreds?.scorers ?? []).forEach((s) => {
      const arr = m.get(s.prediction_id) ?? [];
      arr.push(s.player_id);
      m.set(s.prediction_id, arr);
    });
    return m;
  }, [myPreds]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Match predictions</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick outcome, exact score, and goalscorers. Predictions lock at kickoff.
        </p>
      </header>

      <Tabs value={stage} onValueChange={setStage}>
        <TabsList className="flex flex-wrap h-auto justify-start">
          {STAGES.map((s) => (
            <TabsTrigger key={s.value} value={s.value} className="text-xs sm:text-sm">{s.label}</TabsTrigger>
          ))}
        </TabsList>
        {STAGES.map((s) => {
          const list = matches.filter((m) => m.stage === s.value);
          return (
            <TabsContent key={s.value} value={s.value} className="mt-6">
              {list.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  {s.label} fixtures will appear here as the tournament progresses.
                </Card>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {list.map((m) => {
                    const home = m.home_team_id ? teamMap.get(m.home_team_id) : undefined;
                    const away = m.away_team_id ? teamMap.get(m.away_team_id) : undefined;
                    if (!home || !away) return null;
                    const pred = predMap.get(m.id);
                    const scorers = pred ? scorerByPred.get(pred.id) ?? [] : [];
                    return (
                      <MatchCard
                        key={m.id}
                        match={m}
                        home={home}
                        away={away}
                        players={players}
                        prediction={pred}
                        scorerIds={scorers}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
