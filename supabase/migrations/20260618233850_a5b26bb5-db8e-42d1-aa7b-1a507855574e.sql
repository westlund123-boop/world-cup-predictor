WITH actual AS (
  SELECT mg.match_id, mg.player_id, COUNT(*)::int AS goals
  FROM public.match_goalscorers mg
  GROUP BY mg.match_id, mg.player_id
),
first_scorer AS (
  SELECT match_id, player_id AS first_player_id
  FROM public.match_goalscorers
  WHERE is_first = true
),
pred_other AS (
  SELECT ps.prediction_id, ps.player_id
  FROM public.prediction_scorers ps
  JOIN public.predictions p ON p.id = ps.prediction_id
  WHERE p.first_scorer_player_id IS NULL OR ps.player_id <> p.first_scorer_player_id
),
scored AS (
  SELECT
    p.id AS prediction_id,
    CASE
      WHEN (p.outcome='1' AND m.home_score > m.away_score)
        OR (p.outcome='2' AND m.home_score < m.away_score)
        OR (p.outcome='X' AND m.home_score = m.away_score)
      THEN 5 ELSE 0
    END
    +
    CASE
      WHEN p.home_score = m.home_score AND p.away_score = m.away_score THEN 10
      WHEN (p.home_score - p.away_score) = (m.home_score - m.away_score) THEN 5
      WHEN (p.home_score + p.away_score) = (m.home_score + m.away_score) THEN 5
      ELSE 0
    END
    +
    COALESCE((
      SELECT 10 + 5 * GREATEST(0, a.goals - 1)
      FROM actual a
      JOIN first_scorer fs ON fs.match_id = a.match_id AND fs.first_player_id = a.player_id
      WHERE a.match_id = p.match_id
        AND p.first_scorer_player_id IS NOT NULL
        AND a.player_id = p.first_scorer_player_id
    ), 0)
    +
    COALESCE((
      SELECT 5 * a.goals
      FROM pred_other po
      JOIN actual a ON a.match_id = p.match_id AND a.player_id = po.player_id
      WHERE po.prediction_id = p.id
      ORDER BY a.goals DESC
      LIMIT 1
    ), 0)
    +
    CASE
      WHEN m.stage IN ('r32','r16','qf','sf','final')
       AND m.winner_team_id IS NOT NULL
       AND (
         (p.outcome='1' AND m.home_team_id = m.winner_team_id) OR
         (p.outcome='2' AND m.away_team_id = m.winner_team_id) OR
         (p.outcome='X' AND (
            (p.home_score > p.away_score AND m.home_team_id = m.winner_team_id) OR
            (p.away_score > p.home_score AND m.away_team_id = m.winner_team_id) OR
            (p.home_score = p.away_score AND m.home_team_id = m.winner_team_id)
         ))
       )
      THEN CASE m.stage WHEN 'final' THEN 25 WHEN 'sf' THEN 15 ELSE 10 END
      ELSE 0
    END AS pts
  FROM public.predictions p
  JOIN public.matches m ON m.id = p.match_id
  WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
)
UPDATE public.predictions tgt
SET points = s.pts
FROM scored s
WHERE tgt.id = s.prediction_id;

UPDATE public.leaderboard_cache lc
SET total = COALESCE(sub.total,0)
          + COALESCE(lc.knockout_points,0)
          + COALESCE(lc.top3_points,0)
          + COALESCE(lc.top_scorer_points,0),
    updated_at = now()
FROM (
  SELECT user_id, SUM(points)::int AS total
  FROM public.predictions
  GROUP BY user_id
) sub
WHERE lc.user_id = sub.user_id;