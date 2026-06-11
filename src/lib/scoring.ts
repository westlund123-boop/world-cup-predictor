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

/**
 * Match scoring:
 *  - Correct 1/X/2 outcome = 5
 *  - Exact final score = +10 bonus (on top of the 1X2)
 *  - Correct goal difference (not exact) = +5
 *  - Correct total goals (and not the above) = +5
 */
export function scoreMatchPrediction(
  pred: { outcome: string; home_score: number; away_score: number },
  result: { home_score: number; away_score: number }
): { match_points: number; exact: boolean; correct_1x2: boolean } {
  const actual = outcomeOf(result.home_score, result.away_score);
  const correct_1x2 = pred.outcome === actual;
  let pts = 0;
  if (correct_1x2) pts += 5;

  const exact = pred.home_score === result.home_score && pred.away_score === result.away_score;
  if (exact) pts += 10;
  else if (pred.home_score - pred.away_score === result.home_score - result.away_score) pts += 5;
  else if (pred.home_score + pred.away_score === result.home_score + result.away_score) pts += 5;

  return { match_points: pts, exact, correct_1x2 };
}

/**
 * Goalscorer points (max 15 per match):
 *  - +10 if first_scorer matches the actual first scorer
 *  - +5 if the (single) other-scorer pick appears in the actual scorers
 * Rule change: users may only pick ONE other goalscorer. If older data has
 * more than one row stored, only the first matching pick is awarded.
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
    pts += 10;
  }
  const actualSet = new Set(actual.scorer_player_ids);
  for (const pid of pred.scorer_ids) {
    if (pid === pred.first_scorer_player_id) continue;
    if (actualSet.has(pid)) {
      pts += 5;
      break; // award at most ONE other-scorer bonus per match
    }
  }
  return Math.min(pts, 15);
}


/**
 * Knockout advancement points: based on the predicted winner team for a KO match.
 *  - Final winner: 25
 *  - SF winner (i.e. correct finalist): 15
 *  - any other KO match (R32/R16/QF) correct: 10
 */
export function knockoutPointsForStage(stage: string): number {
  if (stage === "final") return 25;
  if (stage === "sf") return 15;
  if (stage === "r32" || stage === "r16" || stage === "qf") return 10;
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

/** Top-3 scoring: 50/25/15 exact, 10 for any correct team in wrong podium slot. */
export function scoreTop3(
  pred: { winner_team_id: string; runner_up_team_id: string; third_team_id: string },
  actual: { winner_team_id: string | null; runner_up_team_id: string | null; third_team_id: string | null }
): number {
  if (!actual.winner_team_id || !actual.runner_up_team_id || !actual.third_team_id) return 0;
  let pts = 0;
  if (pred.winner_team_id === actual.winner_team_id) pts += 50;
  else if (
    pred.winner_team_id === actual.runner_up_team_id ||
    pred.winner_team_id === actual.third_team_id
  ) pts += 10;

  if (pred.runner_up_team_id === actual.runner_up_team_id) pts += 25;
  else if (
    pred.runner_up_team_id === actual.winner_team_id ||
    pred.runner_up_team_id === actual.third_team_id
  ) pts += 10;

  if (pred.third_team_id === actual.third_team_id) pts += 15;
  else if (
    pred.third_team_id === actual.winner_team_id ||
    pred.third_team_id === actual.runner_up_team_id
  ) pts += 10;

  return pts;
}

/**
 * Top Scorer League scoring (applied against the final/derived top-10 standings).
 *  - 25 if you put the actual top scorer (rank 1) in your rank-1 slot
 *  - 15 for any other player who is in the exact correct rank
 *  - 5 for a predicted player who is in the actual top 10 but in the wrong rank
 * Each predicted player counts once — highest applicable value only.
 *
 * `predicted`: array of length up to 10, index 0 = rank 1.
 * `actualTop10`: array of player_id ranked 1..10. Ties share the same rank
 *  (so the array length may exceed 10 if there are tied players spanning the cutoff).
 *  We use the supplied ordering for the rank-match check.
 */
export function scoreTopScorerLeague(
  predicted: (string | null)[],
  actualRankByPlayer: Map<string, number>, // player_id -> rank (1..N, ties share rank)
): number {
  let pts = 0;
  for (let i = 0; i < predicted.length; i++) {
    const pid = predicted[i];
    if (!pid) continue;
    const predictedRank = i + 1;
    const actualRank = actualRankByPlayer.get(pid);
    if (actualRank === undefined) continue;
    if (predictedRank === 1 && actualRank === 1) {
      pts += 25;
    } else if (actualRank === predictedRank) {
      pts += 15;
    } else if (actualRank <= 10) {
      pts += 5;
    }
  }
  return pts;
}
