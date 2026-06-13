import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ match_id: z.string().uuid() });

const ODDS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SPORT_KEYS = ["soccer_fifa_world_cup", "soccer_fifa_world_cup_2026"];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

const ALIASES: Record<string, string> = {
  usa: "unitedstates",
  us: "unitedstates",
  unitedstatesofamerica: "unitedstates",
  southkorea: "korearepublic",
  northkorea: "koreadpr",
  ivorycoast: "cotedivoire",
  czechia: "czechrepublic",
  turkey: "turkiye",
};
function canon(s: string): string {
  const n = norm(s);
  return ALIASES[n] ?? n;
}

type OddsEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: Array<{
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
};

async function fetchOddsFromApi(): Promise<OddsEvent[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY saknas i servermiljön");
  const all: OddsEvent[] = [];
  for (const sport of SPORT_KEYS) {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[odds] HTTP", res.status, "for", sport);
      continue;
    }
    const json = (await res.json()) as OddsEvent[];
    if (Array.isArray(json)) all.push(...json);
  }
  console.log("[odds] fetched events:", all.length);
  return all;
}

function computePcts(ev: OddsEvent, homeName: string, awayName: string) {
  const homeC = canon(homeName);
  const awayC = canon(awayName);
  const invH: number[] = [];
  const invD: number[] = [];
  const invA: number[] = [];
  for (const bm of ev.bookmakers ?? []) {
    const m = bm.markets?.find((x) => x.key === "h2h");
    if (!m) continue;
    let h: number | undefined, d: number | undefined, a: number | undefined;
    for (const o of m.outcomes) {
      const nm = canon(o.name);
      if (nm === homeC) h = o.price;
      else if (nm === awayC) a = o.price;
      else if (nm === "draw" || nm === "tie") d = o.price;
    }
    if (h && d && a) {
      invH.push(1 / h);
      invD.push(1 / d);
      invA.push(1 / a);
    }
  }
  if (invH.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const aH = avg(invH), aD = avg(invD), aA = avg(invA);
  const sum = aH + aD + aA;
  return {
    home_pct: Math.round((aH / sum) * 1000) / 10,
    draw_pct: Math.round((aD / sum) * 1000) / 10,
    away_pct: Math.round((aA / sum) * 1000) / 10,
  };
}

async function refreshOddsForMatch(match_id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: m } = await supabaseAdmin
    .from("matches")
    .select("id,home_team_id,away_team_id")
    .eq("id", match_id)
    .maybeSingle();
  if (!m || !m.home_team_id || !m.away_team_id) return null;
  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("id,name")
    .in("id", [m.home_team_id, m.away_team_id]);
  const home = teams?.find((t) => t.id === m.home_team_id);
  const away = teams?.find((t) => t.id === m.away_team_id);
  if (!home || !away) return null;

  const events = await fetchOddsFromApi();
  const homeC = canon(home.name);
  const awayC = canon(away.name);
  const ev = events.find((e) => {
    const a = canon(e.home_team);
    const b = canon(e.away_team);
    return (a === homeC && b === awayC) || (a === awayC && b === homeC);
  });
  if (!ev) {
    console.log("[odds] no match found for", home.name, "vs", away.name);
    return null;
  }
  // If teams flipped by bookmaker, still compute correctly via outcome names
  const pcts = computePcts(ev, home.name, away.name);
  if (!pcts) return null;
  const row = {
    match_id,
    home_pct: pcts.home_pct,
    draw_pct: pcts.draw_pct,
    away_pct: pcts.away_pct,
    source: "the-odds-api",
    fetched_at: new Date().toISOString(),
  };
  await supabaseAdmin.from("match_odds").upsert(row, { onConflict: "match_id" });
  return row;
}

export const getMatchOdds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cached } = await supabaseAdmin
      .from("match_odds")
      .select("home_pct,draw_pct,away_pct,fetched_at")
      .eq("match_id", data.match_id)
      .maybeSingle();
    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ODDS_TTL_MS) {
      return cached;
    }
    try {
      const fresh = await refreshOddsForMatch(data.match_id);
      return fresh ?? cached ?? null;
    } catch (e: any) {
      console.error("[odds] refresh failed:", e?.message);
      return cached ?? null;
    }
  });

export const getMatchConsensus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("get_match_consensus", {
      match_uuid: data.match_id,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ?? { home_pct: null, draw_pct: null, away_pct: null, total: 0, locked: false };
  });
