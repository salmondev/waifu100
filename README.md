This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Story100 (anime & manga grids)

`/story` builds a 3×3, Top 10, Top 50 or Top 100 grid of anime or manga; shares open at `/story/v/<id>` with their own title and OG card. Same app, same deploy, same Redis.

- Search runs in the browser: AniList GraphQL (`isAdult: false`), Jikan (`sfw=true`) only when AniList answers 429/5xx; a 429's Retry-After pauses AniList calls. Credit "Data from AniList" is shown.
- Shares: same `waifu100:share:<id>` key, payload schema v2 adds `meta.v`, `meta.kind`, `meta.size` (absent = waifu/100, so every old share still reads). Story cells store only `{i, a: media id, t, img: cover URL, n: title<=120}`. Story shares are also indexed in `waifu100:feed:story`; the main `waifu100:feed` still lists everything.
- Community: All / Waifu / Story tabs (`/api/community?kind=`), kind badge on cards. Compare and AI verdict stay waifu-only.
- Product switches live in `src/lib/story/config.ts`. Server data layer: Effect v4 services in `src/server/` (ShareRepo with an in-memory test layer, typed errors).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
