// Pure scoring helpers — shared by UI and the recalculation engine.

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

export type PredictionScore = {
  match_points: number;
  goalscorer_points: number;
  exact: boolean;
  correct_1x2: boolean;
};

export function scoreMatchPrediction(
  pred: { outcome: string; home_score: number; away_score: number },
  result: { home_score: number; away_score: number }
): { match_points: number; exact: boolean; correct_1x2: boolean } {
  const actual = outcomeOf(result.home_score, result.away_score);
  const correct_1x2 = pred.outcome === actual;
  let pts = 0;
  if (correct_1x2) pts += 3;

  const exact = pred.home_score === result.home_score && pred.away_score === result.away_score;
  if (exact) pts += 5;
  else if (pred.home_score - pred.away_score === result.home_score - result.away_score) pts += 2;
  else if (pred.home_score + pred.away_score === result.home_score + result.away_score) pts += 1;

  return { match_points: pts, exact, correct_1x2 };
}

/**
 * Scorer points (capped at 8 / match).
 *  - +2 per other scorer correctly picked (player appears in actual scorers)
 *  - +4 if first_scorer matches the actual first scorer
 */
export function scoreGoalscorers(
  pred: { first_scorer_player_id: string | null; scorer_ids: string[] },
  actual: { first_scorer_player_id: string | null; scorer_player_ids: string[] }
): number {
  let pts = 0;
  if (
    pred.first_scorer_player_id &&
    actual.first_scorer_player_id &&
    pred.first_scorer_player_id === actual.first_scorer_player_id
  ) {
    pts += 4;
  }
  const actualSet = new Set(actual.scorer_player_ids);
  for (const pid of pred.scorer_ids) {
    if (pid === pred.first_scorer_player_id) continue;
    if (actualSet.has(pid)) pts += 2;
  }
  return Math.min(pts, 8);
}

/**
 * Knockout advancement points: based on the predicted winner team for a KO match.
 *  - final winner: 15
 *  - SF winner (i.e. correct finalist): 8
 *  - any other KO match correct: 3
 */
export function knockoutPointsForStage(stage: string): number {
  if (stage === "final") return 15;
  if (stage === "sf") return 8;
  if (stage === "r32" || stage === "r16" || stage === "qf") return 3;
  return 0;
}

/** Compute the team the user predicted to win for a KO match. */
export function predictedWinner(
  pred: { outcome: string; home_score: number; away_score: number },
  match: { home_team_id: string | null; away_team_id: string | null }
): string | null {
  if (!match.home_team_id || !match.away_team_id) return null;
  if (pred.outcome === "1") return match.home_team_id;
  if (pred.outcome === "2") return match.away_team_id;
  // Draw predicted in a KO: fall back to higher score side, else home
  if (pred.home_score > pred.away_score) return match.home_team_id;
  if (pred.away_score > pred.home_score) return match.away_team_id;
  return match.home_team_id;
}

/** Top-3 scoring: 20/15/10 exact, 5 for any correct team in wrong slot. */
export function scoreTop3(
  pred: { winner_team_id: string; runner_up_team_id: string; third_team_id: string },
  actual: { winner_team_id: string | null; runner_up_team_id: string | null; third_team_id: string | null }
): number {
  if (!actual.winner_team_id || !actual.runner_up_team_id || !actual.third_team_id) return 0;
  let pts = 0;
  if (pred.winner_team_id === actual.winner_team_id) pts += 20;
  else if (
    pred.winner_team_id === actual.runner_up_team_id ||
    pred.winner_team_id === actual.third_team_id
  ) pts += 5;

  if (pred.runner_up_team_id === actual.runner_up_team_id) pts += 15;
  else if (
    pred.runner_up_team_id === actual.winner_team_id ||
    pred.runner_up_team_id === actual.third_team_id
  ) pts += 5;

  if (pred.third_team_id === actual.third_team_id) pts += 10;
  else if (
    pred.third_team_id === actual.winner_team_id ||
    pred.third_team_id === actual.runner_up_team_id
  ) pts += 5;

  return pts;
}
