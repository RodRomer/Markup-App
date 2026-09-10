# Markup App (Rune)

Next.js 16 / Prisma / Neon Postgres. Clients open a link, place IE, section and
revision markers on a plan set, and submit; staff create the projects and pull
the marked-up PDF back — from the web console here, or from Waystone's Rune tab.
The app itself is in `markup-app/`.

| | |
|---|---|
| Production | https://runemarks.vercel.app |
| Staff console | the same address — sign in with a team name and password |
| Desktop client | Waystone's Rune tab, `github.com/RodRomer/Waystone` |

**Client review links are `runemarks.vercel.app/markup/<token>` and are already
in clients' hands.** Anything that changes that hostname breaks links that
cannot be reissued without asking the client to start their markup again.

## Careful: `npm run build` writes to production

`build` is `prisma migrate deploy && prisma generate && next build`, and the
`DATABASE_URL` in the local `.env` **is the production database**. Running
`npm run build` on your machine applies pending migrations to live data.

```sh
npx next build     # compile locally — this is the one you want
npm test           # 92 tests
npx prisma studio  # browse the live database, read-only unless you edit
```

Migrations are written by hand into `prisma/migrations/<timestamp>_<name>/` and
applied by Vercel during its own build.

## Remotes

This repo pushes to two places from one `git push`:

- `github.com/RodRomer/Markup-App` — **what Vercel deploys from**
- `github.com/ppmco/Markup-App` — the company copy

The same history, not a fork. Do all work in this tree; pushing to the company
copy directly makes the two diverge and every later push fails. When hosting
moves to PPM, repoint Vercel's Git link and drop the personal push URL.

## What is not in this repo

Secrets live in Vercel's environment (production) and a local `.env` (dev);
neither is committed. The Neon database and the Vercel Blob store holding
client plan images are separate accounts and do not move with this repo.
