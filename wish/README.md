# wish.arshnah.in

A reusable celebration microsite. One system, many pages — each celebration is
one JSON file, not new code.

## Adding a celebration

```bash
cd microsites/wish
cp src/content/celebrations/_template.json src/content/celebrations/friend-name-2026.json
# edit the json — set slug to match the filename
npm run build   # sanity check locally, optional
git add . && git commit -m "add: friend-name birthday"
git push && vercel --prod --yes   # this project is CLI-deployed like its siblings
```

The `slug` field must match what you want the URL to be
(`wish.arshnah.in/<slug>`) — the filename itself doesn't matter, but keeping
them the same makes the folder readable.

`_template.json` (and anything else starting with `_`) is never built into a
real page — that's enforced in `[slug].astro`'s `getStaticPaths`, not just a
naming convention you have to remember.

## Section types

Mix and match per celebration, in any order, skip what you don't need:
`message`, `timeline`, `gallery`, `wishes`, `stats`. Schema + validation lives
in `src/content/config.ts` — Astro will fail the build with a clear error if a
JSON file doesn't match it (wrong section `type`, missing field, etc.), which
is the whole point of using a typed content collection instead of hand-rolling
JSON loading.

`message` and `wishes` text supports a tiny markdown subset: `**bold**`,
`*italic*`, `[text](url)` (see `src/lib/md.ts`) — same subset `now.arshnah.in`
uses for its focus editor, not a full markdown parser.

## Countdown + the signature move

If `countdown_to` is a future ISO datetime, the hero shows a live ticking
countdown with a flame glyph that flickers (`src/components/Countdown.astro`)
— that's this project's one signature move per the grain design rules. The
instant the target time passes, the flicker stops and the flame holds a
steady glow; the digits are replaced with a "wish granted" line. Past or
missing `countdown_to` just skips the countdown entirely.

## Guestbook — needs one-time setup before it works

`guestbook_enabled: true` mounts a real guestbook (`src/components/Guestbook.astro`)
that reads/writes through `api/wish-guestbook.js`, a Vercel serverless
function — but **it needs its own Supabase table and env vars, neither of
which exist yet.** Deliberately NOT wired to reuse portfolio-next's guestbook
table: that one is currently disabled site-side due to a missing
`GRANT INSERT ... TO anon`, and reusing it would inherit the same bug.

One-time setup, once you've decided which Supabase project to use (a new one,
or the same project as portfolio-next's guestbook — either works, this is a
separate table either way):

```sql
create table if not exists wish_guestbook (
  id bigint generated always as identity primary key,
  slug text not null,
  name text not null,
  message text not null,
  created_at timestamptz not null default now()
);
alter table wish_guestbook enable row level security;
create policy "public read" on wish_guestbook for select using (true);
create policy "public insert" on wish_guestbook for insert with check (true);
grant select, insert on wish_guestbook to anon;
```

Then set on the Vercel project (`vercel env add <NAME> production`):
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (required) and optionally
`SUPABASE_SERVICE_ROLE_KEY` (bypasses the anon grants above if you'd rather
lock those down and write via service role instead).

Until that's done, `guestbook_enabled: true` shows the form, but submissions
will fail with "guestbook not configured" — it fails loudly, not silently.

## Private pages

`private: true` removes a celebration from the `/` index listing. It's
**unlisted, not access-controlled** — the page still renders normally at its
direct URL for anyone who has the link, same trust model as an unlisted
YouTube video. A real passcode gate is a v2 item (see below), not built yet.

## What's NOT built yet (v2, per the original plan)

- Passcode gate for `private` pages (currently just unlisted, see above)
- Confetti/particle burst firing exactly on the celebration date
- Auto-generated OG image per slug for link previews
- RSVP-style form tied to a specific slug (the `wishes` section is
  hand-curated static content in the JSON; the live guestbook is the only
  dynamic input mechanism right now)

## Design

Material = a birthday candle (grain design system, see `/grain.md` at the
repo root): warm near-black, one amber accent, soft radius. Space Grotesk +
JetBrains Mono, the fixed pair every arshnah project uses. Add this project's
row to grain.md's material table once it ships for real.
