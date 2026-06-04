// Pure scoring helpers — used by UI for live point hint and by future admin recalc.
export const STAGE_LABEL: Record<string, string> = {
  group: "Group Stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  third: "Third-place match",
  final: "Final",
};

export function matchStatus(kickoff_at: string, status: string): "open" | "locked" | "finished" {
  if (status === "finished") return "finished";
  if (new Date(kickoff_at) <= new Date()) return "locked";
  return "open";
}

export function outcomeOf(home: number, away: number): "1" | "X" | "2" {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

export function scorePrediction(
  pred: { outcome: string; home_score: number; away_score: number },
  result: { home_score: number; away_score: number }
): number {
  let pts = 0;
  const actual = outcomeOf(result.home_score, result.away_score);
  if (pred.outcome === actual) pts += 3;

  const exact = pred.home_score === result.home_score && pred.away_score === result.away_score;
  if (exact) pts += 5;
  else if (pred.home_score - pred.away_score === result.home_score - result.away_score) pts += 2;
  else if (pred.home_score + pred.away_score === result.home_score + result.away_score) pts += 1;

  return pts;
}
