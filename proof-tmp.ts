// Proof script — uses the project's updated extraction + render logic.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function fcScrape(url: string): Promise<string> {
  console.log("[scrape]", url);
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) throw new Error(`scrape ${res.status}`);
  const j: any = await res.json();
  const md = j?.data?.markdown ?? j?.markdown ?? "";
  console.log("  chars:", md.length);
  return md;
}
async function fcSearch(q: string): Promise<string | null> {
  const r = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ query: q, limit: 3 }),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  const arr = j?.data?.web ?? j?.web ?? j?.data ?? [];
  const wiki = (arr as any[]).find((x) => x?.url?.includes?.("wikipedia.org"));
  return wiki?.url ?? arr?.[0]?.url ?? null;
}
async function gemini(system: string, user: string, json = false): Promise<string> {
  const body: any = { model: "google/gemini-3-flash-preview", messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (json) body.response_format = { type: "json_object" };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0,200)}`);
  const j: any = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() ?? "";
}

function safeInt(v: any) { return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null; }

const ALLOWED_TF = new Set(["senaste 10", "kval 2025-26", "landskamper 2025-26", "landslagsmål totalt"]);

async function extract(team: string, md: string, src: string) {
  const trimmed = md.slice(0, 60000);
  const system = `You extract structured football national-team form data from Wikipedia markdown. Return ONLY valid JSON. Use null where unverifiable. NEVER invent numbers or names.`;
  const user = `Team: ${team}
Source: ${src}

From the Wikipedia markdown below, extract the team's most recent competitive senior men's national-team matches with final scores.

Return JSON:
{
  "last10_results": "WDLWW..." | null,
  "wins": int|null, "draws": int|null, "losses": int|null,
  "goals_for": int|null, "goals_against": int|null,
  "top_scorers": [{"name": str, "goals": int, "timeframe": str}] | null
}

TOP-SCORER RULES (critical):
- Only count goals in a RECENT window. Allowed timeframe labels, in order of preference:
    1) "senaste 10" — goals tallied from the same ≤10 recent matches above
    2) "kval 2025-26" — goals in the current World Cup 2026 qualifying campaign
    3) "landskamper 2025-26" — goals in 2025 + 2026 senior internationals
- DO NOT use Wikipedia's "all-time top scorers" / career-totals tables for recent form.
- Each scorer MUST include "timeframe" matching one of the labels above.
- If the ONLY verifiable number for a player is their career total (from an all-time list), you MAY include them with timeframe="landslagsmål totalt".
- Up to 3 scorers. Skip players whose goal count you cannot read.

Markdown:
---
${trimmed}
---`;
  const text = await gemini(system, user, true);
  let p: any; try { p = JSON.parse(text); } catch { p = JSON.parse(text.match(/\{[\s\S]*\}/)![0]); }
  const seq = typeof p.last10_results === "string" ? p.last10_results.toUpperCase().replace(/[^WDL]/g, "").slice(0,10) || null : null;
  let scorers = null as any;
  if (Array.isArray(p.top_scorers)) {
    scorers = p.top_scorers
      .filter((s: any) => s?.name && typeof s.goals === "number" && s.goals > 0 && typeof s.timeframe === "string" && ALLOWED_TF.has(s.timeframe.trim()))
      .slice(0,3)
      .map((s: any) => ({ name: s.name.trim(), goals: Math.floor(s.goals), timeframe: s.timeframe.trim() }));
    if (!scorers.length) scorers = null;
  }
  return { last10_results: seq, wins: safeInt(p.wins), draws: safeInt(p.draws), losses: safeInt(p.losses), goals_for: safeInt(p.goals_for), goals_against: safeInt(p.goals_against), top_scorers: scorers, source: src };
}

async function getForm(teamId: string, name: string) {
  const slug = name.replace(/\s+/g, "_");
  const direct = `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_national_football_team`;
  let url = direct, md = "";
  try { md = await fcScrape(direct); if (md.length < 20000) throw new Error("small"); }
  catch { const f = await fcSearch(`${name} men's national football soccer team site:en.wikipedia.org`); if (!f) throw new Error("no wiki"); url = f; md = await fcScrape(url); }
  const ex = await extract(name, md, url);
  const row = { team_id: teamId, ...ex, fetched_at: new Date().toISOString() };
  await sb.from("team_form").upsert(row, { onConflict: "team_id" });
  console.log(`[${name}]`, ex.last10_results, `${ex.goals_for}-${ex.goals_against}`, JSON.stringify(ex.top_scorers));
  return row;
}

function renderBlock(name: string, f: any): string {
  if (!f || (!f.last10_results && !f.top_scorers)) return "";
  const out = [`**${name}**`];
  if (f.last10_results) {
    const n = f.last10_results.length;
    const tot = f.goals_for !== null && f.goals_against !== null ? ` — ${f.goals_for} gjorda, ${f.goals_against} insläppta` : "";
    out.push(`Form: ${f.last10_results} (senaste ${n})${tot}`);
  }
  if (f.top_scorers?.length) {
    const groups = new Map<string, Array<{name:string;goals:number}>>();
    for (const x of f.top_scorers) {
      const tf = (x.timeframe ?? "senaste 10").trim();
      const arr = groups.get(tf) ?? []; arr.push({name:x.name,goals:x.goals}); groups.set(tf, arr);
    }
    for (const [tf, arr] of groups) {
      out.push(`Heta skyttar (${tf}): ${arr.map(x => `${x.name} (${x.goals} mål)`).join(", ")}`);
    }
  }
  return out.join("\n");
}

async function commentary(h: string, a: string, ko: string, hf: any, af: any) {
  const ctx = [hf, af].map((f, i) => {
    const name = i === 0 ? h : a;
    if (!f) return `${name}: ingen formdata`;
    const sc = (f.top_scorers ?? []).map((s:any) => `${s.name} ${s.goals} (${s.timeframe})`).join("; ") || "?";
    return `${name}: form ${f.last10_results ?? "?"}, mål ${f.goals_for ?? "?"}-${f.goals_against ?? "?"}, skyttar ${sc}`;
  }).join("\n");
  return await gemini(
    `Du är en kvick svensk fotbollsskribent. Skriv kort, lekfullt och faktabaserat. Hitta ALDRIG på siffror eller spelarnamn — använd bara det du får. Blanda ALDRIG karriärtotaler med senaste form. Inga procent, inga odds.`,
    `Match: ${h} vs ${a} (avspark ${ko})

Kontext:
${ctx}

Skriv EXAKT (max 70 ord):

**Att hålla koll på**
1–2 korta punkter. Om du nämner en målgörares siffra, ange tidsramen (t.ex. "i kvalet" eller "landslagsmål totalt"). Hoppa över om kontexten är tom.

**Prediktion**
En lekfull enradare. Ingen procent.`,
  );
}

async function main() {
  const matchId = "39c4c5cb-d11b-4623-8bc1-7ee363a8f2fd";
  const { data: m } = await sb.from("matches").select("id,kickoff_at,home_team_id,away_team_id").eq("id", matchId).single();
  const { data: teams } = await sb.from("teams").select("id,name").in("id", [m!.home_team_id, m!.away_team_id]);
  const home = teams!.find((t:any) => t.id === m!.home_team_id);
  const away = teams!.find((t:any) => t.id === m!.away_team_id);
  console.log(`\n=== ${home.name} vs ${away.name} ===\n`);
  const [hf, af] = await Promise.all([getForm(home.id, home.name), getForm(away.id, away.name)]);
  const stats = [renderBlock(home.name, hf), renderBlock(away.name, af)].filter(Boolean).join("\n\n");
  const c = await commentary(home.name, away.name, m!.kickoff_at, hf, af);
  const content = stats ? `${stats}\n\n${c}` : c;
  await sb.from("match_previews").upsert({ match_id: matchId, content, generated_at: new Date().toISOString() }, { onConflict: "match_id" });
  console.log("\n========== PREVIEW ==========\n");
  console.log(content);
  console.log("\n=============================");
}
main().catch((e) => { console.error(e); process.exit(1); });
