
# FIFA World Cup 2026 Prediction App — Build Plan

Branding inspired by Aumovio: vibrant orange accent on white, deep black text, generous whitespace, clean modern sans-serif. Built as Lovable Cloud app on TanStack Start.

## Phase 1 — Core (this build)

**Pages**
1. Landing / Login (`/`)
2. Register (`/auth`)
3. Dashboard (`/_authenticated/`) — upcoming matches, open predictions, current points, leaderboard rank, quick links
4. Match predictions (`/_authenticated/matches`) — tabs: Group Stage, Round of 32, R16, QF, SF, 3rd, Final
5. Top 3 prediction (`/_authenticated/top3`)
6. Leaderboard (`/_authenticated/leaderboard`) — sortable/filterable
7. Rules (`/rules`, public)

**Prediction card UX**
- Team flag + name on left/right, date/time + group label center
- 1X2 segmented buttons, two number inputs for score, multi-select of goalscorers from each team's squad
- Status badge: Open / Locked / Finished, with countdown to lock
- Server-side guard: writes rejected after `match.kickoff_at`

**Auth**
- Email/password (auto-confirm on, no email verification flow needed for intranet)
- Profile fields: name, department, avatar_url
- `westlund123@gmail.com` auto-assigned `admin` role via trigger on signup

## Phase 2 — Admin & bracket (follow-up)
- Knockout bracket tree page
- Admin: teams/players/matches CRUD, enter result + scorers, recalc points, CSV export
- Bracket auto-advances winners

## Technical Plan

**Stack:** TanStack Start + Lovable Cloud (Supabase) + Tailwind v4 + shadcn/ui. Server functions for all reads/writes with `requireSupabaseAuth`. Public seed data via `supabaseAdmin`-elevated server fn for unauthenticated rules page.

**Design tokens (`src/styles.css`)**
- `--primary`: vivid orange `oklch(0.68 0.21 40)` (Aumovio-style)
- `--primary-glow`, `--gradient-primary` for hero/CTA accents
- Background white, foreground near-black, subtle muted grays
- Rounded `0.75rem`, generous spacing, motion-tasteful

**Database (Phase 1 tables)**

```text
profiles(id uuid pk -> auth.users, name, department, avatar_url, created_at)
user_roles(user_id, role app_role)   -- enum: admin, user
teams(id, name, code, flag_emoji, group_letter)
players(id, team_id, name, position)
matches(id, stage, group_letter, home_team_id, away_team_id,
        kickoff_at, status, home_score, away_score)
match_goalscorers(match_id, player_id)   -- actual scorers
predictions(id, user_id, match_id, outcome '1'|'X'|'2',
            home_score, away_score, submitted_at, points)
prediction_scorers(prediction_id, player_id)
top3_predictions(user_id pk, winner_team_id, runner_up_team_id,
                 third_team_id, submitted_at)
```

All tables: RLS on, `GRANT` to authenticated + service_role. Users read all leaderboard data, write only their own predictions; admin role bypass via `has_role()` security-definer.

**Scoring engine** — pure TS module `src/lib/scoring.ts`, callable from admin "recalc" server fn (Phase 2). Stubbed in Phase 1 with points column on predictions defaulting to 0; leaderboard already reads from it.

**Seed data** — placeholder 48 teams across 12 groups, ~10 squad players per team, all group-stage matches with realistic 2026 dates. Stored in a seed migration so it's easy to swap for the official schedule later.

**Routing**
- Public: `/`, `/auth`, `/rules`
- Protected layout: `src/routes/_authenticated/route.tsx` (ssr:false, redirects to `/auth`)
- Children: `index` (dashboard), `matches`, `top3`, `leaderboard`

**Lock logic** — Both client (disable inputs when `now >= kickoff_at`) and server fn (reject mutation). Status badge derives from kickoff vs now and `status` column.

## What's NOT in Phase 1
- Knockout bracket visualization page
- Admin CRUD UI + result entry UI + recalc + CSV export
- Auto-scoring trigger (column exists, calc deferred)
- Bracket auto-advancement

These ship in Phase 2 right after Phase 1 is verified working.

## Open assumption
Goalscorer pick = multi-select from each team's full squad with no cap on number chosen (max 8 points per match still enforced by scoring). Say the word if you want a hard pick limit (e.g. max 3 per team).
