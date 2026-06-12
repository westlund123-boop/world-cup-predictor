// Standalone proof: generate one match preview using the new team_form pipeline.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

const TTL = 3 * 24 * 60 * 60 * 1000;

async function fcScrape(url: string): Promise<string> {
  console.log("[scrape]", url);
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) throw new Error(`scrape ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const md = j?.data?.markdown ?? j?.markdown ?? "";
  console.log("  → chars:", md.length);
  return md;
}

async function fcSearchUrl(q: string): Promise<string | null> {
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ query: q, limit: 3 }),
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  const arr = j?.data?.web ?? j?.web ?? j?.data ?? [];
  const wiki = (arr as any[]).find((r) => r?.url?.includes?.("wikipedia.org"));
  return wiki?.url ?? arr?.[0]?.url ?? null;
}

async function gemini(system: string, user: string, json = false): Promise<string> {
  const body: any = {
    model: "google/gemini-3-flash-preview",
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  if (json) body.response_format = { type: "json_object" };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() ?? "";
}

function safeInt(v: any) { return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null; }

async function extract(team: string, md: string, src: string) {
  const trimmed = md.slice(0, 60000);
  const sys = `You extract structured football national-team form data from Wikipedia markdown. Return ONLY valid JSON. Use null where unverifiable. NEVER invent numbers or names.`;
  const user = `Team: ${team}
Source: ${src}

Find the most recent senior men's national-team matches with final scores (qualifiers, Nations League, friendlies, tournaments). Look at "Recent results", "Fixtures and results", "Results and fixtures".

Return JSON:
{
  "last10_results": "WDLWW..." | null,  // max 10 chars, most recent first
  "wins": int|null, "draws": int|null, "losses": int|null,
  "goals_for": int|null, "goals_against": int|null,
  "top_scorers": [{"name": str, "goals": int}] | null
}
Rules: only verifiable matches; counts must match sequence length; never pad; null if unknown.

Markdown:
---
${trimmed}
---`;
  const text = await gemini(sys, user, true);
  let p: any;
  try { p = JSON.parse(text); } catch { p = JSON.parse(text.match(/\{[\s\S]*\}/)![0]); }
  const seq = typeof p.last10_results === "string" ? p.last10_results.toUpperCase().replace(/[^WDL]/g, "").slice(0, 10) || null : null;
  let scorers = null as any;
  if (Array.isArray(p.top_scorers)) {
    scorers = p.top_scorers.filter((s: any) => s?.name && typeof s.goals === "number" && s.goals > 0).slice(0, 3).map((s: any) => ({ name: s.name.trim(), goals: Math.floor(s.goals) }));
    if (!scorers.length) scorers = null;
  }
  return {
    last10_results: seq, wins: safeInt(p.wins), draws: safeInt(p.draws), losses: safeInt(p.losses),
    goals_for: safeInt(p.goals_for), goals_against: safeInt(p.goals_against),
    top_scorers: scorers, source: src,
  };
}

async function getTeamForm(teamId: string, name: string) {
  const { data: cached } = await supabaseAdmin.from("team_form").select("*").eq("team_id", teamId).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL) {
    console.log(`[cache hit] ${name}`);
    return cached;
  }
  try {
    const slug = name.replace(/\s+/g, "_");
    const direct = `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_national_football_team`;
    let url = direct, md = "";
    try { md = await fcScrape(direct); if (md.length < 500) throw new Error("small"); }
    catch { const f = await fcSearchUrl(`${name} national football team site:en.wikipedia.org`); if (!f) throw new Error("no wiki"); url = f; md = await fcScrape(f); }
    const ex = await extract(name, md, url);
    const row = { team_id: teamId, ...ex, fetched_at: new Date().toISOString() };
    const { error } = await supabaseAdmin.from("team_form").upsert(row, { onConflict: "team_id" });
    if (error) console.error("upsert err:", error.message);
    console.log(`[refreshed] ${name}:`, ex.last10_results, `${ex.goals_for}-${ex.goals_against}`, ex.top_scorers);
    return row;
  } catch (e: any) {
    console.error(`[fail] ${name}:`, e?.message);
    return cached ?? null;
  }
}

function renderBlock(name: string, f: any): string {
  if (!f || (!f.last10_results && !f.top_scorers)) return "";
  const out = [`**${name}**`];
  if (f.last10_results) {
    const n = f.last10_results.length;
    const tot = f.goals_for !== null && f.goals_against !== null ? ` — ${f.goals_for} gjorda, ${f.goals_against} insläppta` : "";
    out.push(`Form: ${f.last10_results} (senaste ${n})${tot}`);
  }
  if (f.top_scorers?.length) out.push(`Heta skyttar: ${f.top_scorers.map((x: any) => `${x.name} (${x.goals} mål)`).join(", ")}`);
  return out.join("\n");
}

async function commentary(h: string, a: string, ko: string, hf: any, af: any) {
  const ctx = [
    hf ? `${h}: form ${hf.last10_results ?? "?"}, mål ${hf.goals_for ?? "?"}-${hf.goals_against ?? "?"}, skyttar ${(hf.top_scorers ?? []).map((s: any) => `${s.name} ${s.goals}`).join("; ") || "?"}` : `${h}: ingen formdata`,
    af ? `${a}: form ${af.last10_results ?? "?"}, mål ${af.goals_for ?? "?"}-${af.goals_against ?? "?"}, skyttar ${(af.top_scorers ?? []).map((s: any) => `${s.name} ${s.goals}`).join("; ") || "?"}` : `${a}: ingen formdata`,
  ].join("\n");
  return await gemini(
    `Du är en kvick svensk fotbollsskribent. Skriv kort, lekfullt och faktabaserat. Hitta ALDRIG på siffror eller spelarnamn — använd bara det du får. Inga procent, inga odds.`,
    `Match: ${h} vs ${a} (avspark ${ko})

Kontext:
${ctx}

Skriv EXAKT (max 70 ord):

**Att hålla koll på**
1–2 korta punkter, gärna med referens till siffrorna ovan. Hoppa över om kontexten är tom.

**Prediktion**
En lekfull enradare. Ingen procent.`,
    false,
  );
}

async function main() {
  const matchId = process.argv[2] || "39c4c5cb-d11b-4623-8bc1-7ee363a8f2fd"; // Canada vs Bosnia
  const { data: m } = await supabaseAdmin.from("matches").select("id,kickoff_at,home_team_id,away_team_id").eq("id", matchId).single();
  const { data: teams } = await supabaseAdmin.from("teams").select("id,name").in("id", [m!.home_team_id!, m!.away_team_id!]);
  const home = teams!.find((t) => t.id === m!.home_team_id)!;
  const away = teams!.find((t) => t.id === m!.away_team_id)!;
  console.log(`\n=== ${home.name} vs ${away.name} ===\n`);
  const [hf, af] = await Promise.all([getTeamForm(home.id, home.name), getTeamForm(away.id, away.name)]);
  const stats = [renderBlock(home.name, hf), renderBlock(away.name, af)].filter(Boolean).join("\n\n");
  const c = await commentary(home.name, away.name, m!.kickoff_at, hf, af);
  const content = stats ? `${stats}\n\n${c}` : c;
  await supabaseAdmin.from("match_previews").upsert({ match_id: matchId, content, generated_at: new Date().toISOString() }, { onConflict: "match_id" });
  console.log("\n========== GENERATED PREVIEW ==========\n");
  console.log(content);
  console.log("\n=======================================");
}
main().catch((e) => { console.error(e); process.exit(1); });
