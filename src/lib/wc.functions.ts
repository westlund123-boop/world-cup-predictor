import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Public reads ----------

export const getTeams = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("id,name,code,flag_emoji,group_letter")
    .order("group_letter")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getMatches = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select(
      "id,stage,group_letter,kickoff_at,status,home_score,away_score,home_team_id,away_team_id,bracket_code,home_source_code,away_source_code,winner_team_id"
    )
    .order("kickoff_at");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getPlayers = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Paginate to bypass PostgREST's per-request row cap (default 1000),
  // which previously truncated the active-squads list and made some scorers
  // missing from the admin Result dialog.
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("players")
      .select("id,team_id,name,name_on_shirt,position,shirt_number,club,active")
      .eq("active", true)
      .order("team_id")
      .order("shirt_number", { ascending: true, nullsFirst: false })
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
});

// ---------- Authenticated reads ----------

export const getMyPredictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: preds, error } = await supabase
      .from("predictions")
      .select("id,match_id,outcome,home_score,away_score,first_scorer_player_id,points,needs_repick")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const { data: scorers } = await supabase
      .from("prediction_scorers")
      .select("prediction_id,player_id");

    return { predictions: preds ?? [], scorers: scorers ?? [] };
  });


export const getMyTop3 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("top3_predictions")
      .select("winner_team_id,runner_up_team_id,third_team_id,points,submitted_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,name,department,avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    return {
      profile,
      isAdmin: (roles ?? []).some((r) => r.role === "admin"),
    };
  });

export const getLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: profiles }, { data: preds }, { data: top3 }] = await Promise.all([
      supabase.from("profiles").select("id,name,department,avatar_url"),
      supabase.from("predictions").select("user_id,points,outcome,home_score,away_score,match_id"),
      supabase.from("top3_predictions").select("user_id,points,submitted_at"),
    ]);

    const rows = (profiles ?? []).map((p) => {
      const mine = (preds ?? []).filter((x) => x.user_id === p.id);
      const matchPts = mine.reduce((s, x) => s + (x.points ?? 0), 0);
      const top3row = (top3 ?? []).find((t) => t.user_id === p.id);
      return {
        user_id: p.id,
        name: p.name,
        department: p.department,
        avatar_url: p.avatar_url,
        match_points: matchPts,
        top3_points: top3row?.points ?? 0,
        total: matchPts + (top3row?.points ?? 0),
        predictions_made: mine.length,
        top3_submitted_at: top3row?.submitted_at ?? null,
      };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  });

// ---------- Mutations ----------

const PredictionInput = z.object({
  match_id: z.string().uuid(),
  outcome: z.enum(["1", "X", "2"]),
  home_score: z.number().int().min(0).max(20),
  away_score: z.number().int().min(0).max(20),
  first_scorer_player_id: z.string().uuid().nullable().optional(),
  // Rule update: at most ONE other goalscorer allowed per prediction.
  scorer_ids: z.array(z.string().uuid()).max(1).default([]),
});

export const upsertPrediction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PredictionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Defensive clamp in case an older client sends more than one.
    const scorerIds = data.scorer_ids.slice(0, 1);

    const { data: existing } = await supabase
      .from("predictions")
      .select("id")
      .eq("user_id", userId)
      .eq("match_id", data.match_id)
      .maybeSingle();

    let predictionId: string;
    if (existing) {
      const { error } = await supabase
        .from("predictions")
        .update({
          outcome: data.outcome,
          home_score: data.home_score,
          away_score: data.away_score,
          first_scorer_player_id: data.first_scorer_player_id ?? null,
          needs_repick: false,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      predictionId = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("predictions")
        .insert({
          user_id: userId,
          match_id: data.match_id,
          outcome: data.outcome,
          home_score: data.home_score,
          away_score: data.away_score,
          first_scorer_player_id: data.first_scorer_player_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      predictionId = inserted.id;
    }

    // Replace scorers (max 1)
    await supabase.from("prediction_scorers").delete().eq("prediction_id", predictionId);
    if (scorerIds.length > 0) {
      const rows = scorerIds.map((player_id) => ({ prediction_id: predictionId, player_id }));
      const { error: sErr } = await supabase.from("prediction_scorers").insert(rows);
      if (sErr) throw new Error(sErr.message);
    }
    return { ok: true };
  });


const Top3Input = z.object({
  winner_team_id: z.string().uuid(),
  runner_up_team_id: z.string().uuid(),
  third_team_id: z.string().uuid(),
});

export const upsertTop3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Top3Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ids = [data.winner_team_id, data.runner_up_team_id, data.third_team_id];
    if (new Set(ids).size !== 3) throw new Error("Pick three distinct teams");

    // Lock if any knockout match has started
    const { data: ko } = await supabase
      .from("matches")
      .select("kickoff_at,stage")
      .neq("stage", "group")
      .order("kickoff_at")
      .limit(1);
    if (ko && ko.length > 0 && new Date(ko[0].kickoff_at) <= new Date()) {
      throw new Error("Top 3 predictions are locked — knockout stage has started");
    }

    const { error } = await supabase.from("top3_predictions").upsert({
      user_id: userId,
      winner_team_id: data.winner_team_id,
      runner_up_team_id: data.runner_up_team_id,
      third_team_id: data.third_team_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ProfileInput = z.object({
  name: z.string().min(1).max(100),
  department: z.string().max(100).nullable().optional(),
  avatar_url: z.string().url().nullable().optional().or(z.literal("")),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        name: data.name,
        department: data.department || null,
        avatar_url: data.avatar_url || null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Wall messages (klotterplank) ----------

export const getWallMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: msgs, error } = await supabase
      .from("wall_messages")
      .select("id,author_id,body,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const authorIds = Array.from(new Set((msgs ?? []).map((m) => m.author_id)));
    const { data: profiles } = authorIds.length
      ? await supabase.from("profiles").select("id,name,avatar_url").in("id", authorIds)
      : { data: [] as { id: string; name: string | null; avatar_url: string | null }[] };
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (msgs ?? []).map((m) => ({
      ...m,
      author_name: pmap.get(m.author_id)?.name ?? "Anonymous",
      author_avatar: pmap.get(m.author_id)?.avatar_url ?? null,
    }));
  });

const WallInput = z.object({ body: z.string().trim().min(1).max(500) });

export const postWallMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WallInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wall_messages")
      .insert({ author_id: userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWallMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("wall_messages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Top Scorer League ----------

/**
 * Compute live standings derived from match_goalscorers (goals across finished matches).
 * Returns players sorted by goal count descending. Ties share the same rank (1224 system).
 */
export const getTopScorerStandings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: scorers, error: sErr }, { data: matches, error: mErr }] = await Promise.all([
    supabaseAdmin.from("match_goalscorers").select("match_id,player_id"),
    supabaseAdmin.from("matches").select("id,status"),
  ]);
  // Paginate players to avoid PostgREST row cap truncating squads.
  const players: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: pErr } = await supabaseAdmin
      .from("players")
      .select("id,name,name_on_shirt,team_id,shirt_number,position")
      .range(from, from + 999);
    if (pErr) throw new Error(pErr.message);
    if (!data || data.length === 0) break;
    players.push(...data);
    if (data.length < 1000) break;
  }
  if (sErr) throw new Error(sErr.message);
  if (mErr) throw new Error(mErr.message);
  if (pErr) throw new Error(pErr.message);

  const finishedMatchIds = new Set((matches ?? []).filter((m) => m.status === "finished").map((m) => m.id));
  const counts = new Map<string, number>();
  for (const g of scorers ?? []) {
    if (!finishedMatchIds.has(g.match_id)) continue;
    counts.set(g.player_id, (counts.get(g.player_id) ?? 0) + 1);
  }

  const playerMap = new Map((players ?? []).map((p) => [p.id, p]));
  const rows = Array.from(counts.entries())
    .map(([player_id, goals]) => {
      const pl = playerMap.get(player_id);
      return {
        player_id,
        goals,
        name: pl?.name ?? "—",
        name_on_shirt: pl?.name_on_shirt ?? null,
        team_id: pl?.team_id ?? null,
        shirt_number: pl?.shirt_number ?? null,
        position: pl?.position ?? null,
      };
    })
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  // Dense rank with shared rank for ties (1, 2, 2, 4, ...)
  let lastGoals = -1;
  let lastRank = 0;
  const ranked = rows.map((r, idx) => {
    if (r.goals !== lastGoals) {
      lastRank = idx + 1;
      lastGoals = r.goals;
    }
    return { ...r, rank: lastRank };
  });

  return ranked;
});

export const getMyTopScorerLeague = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: parent }, { data: picks }] = await Promise.all([
      supabase
        .from("top_scorer_predictions")
        .select("user_id,submitted_at,points")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("top_scorer_prediction_picks")
        .select("rank,player_id")
        .eq("user_id", userId)
        .order("rank"),
    ]);
    return { parent: parent ?? null, picks: picks ?? [] };
  });

const TopScorerLeagueInput = z.object({
  picks: z
    .array(z.object({ rank: z.number().int().min(1).max(10), player_id: z.string().uuid() }))
    .length(10),
});

export const upsertTopScorerLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TopScorerLeagueInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Lock if the tournament has started (any match has kicked off).
    const { data: started } = await supabase
      .from("matches")
      .select("kickoff_at")
      .order("kickoff_at")
      .limit(1);
    if (started && started.length > 0 && new Date(started[0].kickoff_at) <= new Date()) {
      throw new Error("Top Scorer League predictions are locked — the tournament has started");
    }

    // Validate: 10 distinct players, ranks 1..10 exactly once
    const ranks = data.picks.map((p) => p.rank).sort((a, b) => a - b);
    for (let i = 0; i < 10; i++) {
      if (ranks[i] !== i + 1) throw new Error("Ranks must be 1 through 10, each once");
    }
    const playerIds = data.picks.map((p) => p.player_id);
    if (new Set(playerIds).size !== 10) throw new Error("Pick 10 distinct players");

    // Verify players exist
    const { data: pls, error: pErr } = await supabase.from("players").select("id").in("id", playerIds);
    if (pErr) throw new Error(pErr.message);
    if ((pls ?? []).length !== 10) throw new Error("One or more selected players are invalid");

    // Upsert parent row
    const { error: upErr } = await supabase
      .from("top_scorer_predictions")
      .upsert({ user_id: userId, submitted_at: new Date().toISOString() });
    if (upErr) throw new Error(upErr.message);

    // Replace picks atomically
    const { error: delErr } = await supabase
      .from("top_scorer_prediction_picks")
      .delete()
      .eq("user_id", userId);
    if (delErr) throw new Error(delErr.message);

    const rows = data.picks.map((p) => ({ user_id: userId, rank: p.rank, player_id: p.player_id }));
    const { error: insErr } = await supabase.from("top_scorer_prediction_picks").insert(rows);
    if (insErr) throw new Error(insErr.message);

    return { ok: true };
  });
