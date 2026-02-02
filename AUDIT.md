# Production Deployment Audit 🚀

This document outlines both **Project-Specific** checks for Waifu100 and **General Best Practices** for deploying any modern web application to production.

---

## 🎯 Part 1: Waifu100 Project Specifics

### 1. Critical Feature Verification
- [ ] **Data Export**:
  - Drag & drop a large local image (~5MB) into the grid.
  - Export the grid. **Verify**: No timeouts, no 414 errors, and *no duplicate "ghost" images* in empty cells.
- [ ] **Data Persistence**:
  - Close the tab and reopen it. **Verify**: Grid state (including uploaded images) loads correctly from `localStorage`.
- [ ] **API Resilience**:
  - Rapidly click "Gallery" on multiple characters. **Verify**: The app handles API rate limits gracefully (loading states shown) without crashing.

### 2. Environment Configuration
- [ ] **Secrets**: Ensure the following are set in the production environment (Vercel/Netlify Dashboard):
  - `GEMINI_API_KEY` - For AI suggestions and query optimization
  - `SERPER_API_KEY` - For Google Image search via Serper API
- [ ] **CORS**: If hosting images or APIs on a different domain, verify `next.config.ts` image domains.

---

## 🛡️ Part 2: General Web Production Best Practices

### 1. Security Hardening 🔒
- [ ] **Security Headers**: Configure `next.config.js` or middleware to set:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (Prevent clickjacking)
  - `Strict-Transport-Security` (HSTS)
- [ ] **Dependency Audit**: Run `npm audit` or `bun pm audit` to check for known vulnerabilities in `package.json`.
- [ ] **Input Sanitization**: Ensure no user input (search queries, uploaded filenames) is rendered as raw HTML (`dangerouslySetInnerHTML`) to prevent XSS.

### 2. Performance & Vitals ⚡
- [ ] **Lighthouse Score**: Run a Chrome Lighthouse audit on the deployment URL. Target 90+ in:
  - **Performance**: (LCP, CLS, FID). *Tip: optimization of the 100 images in the grid is crucial here.*
  - **SEO**: Ensure meta tags exist.
- [ ] **Bundle Size**: Run `next build` with `@next/bundle-analyzer` periodically to ensure no massive libraries (like `moment.js` or full `lodash`) are leaking into the client bundle.
- [ ] **Image Optimization**:
  - Use `next/image` where possible (we use a hybrid approach).
  - Ensure `sizes` attribute is set correctly to prevent loading 4K images for 100px thumbnails.

### 3. SEO & Accessibility (A11y) 🌍
- [ ] **Metadata**:
  - **Title/Description**: Unique and descriptive for every page.
  - **Open Graph (OG)**: Add `og:image` so the link looks good when shared on Twitter/Discord.
- [ ] **Sitemap & Robots**:
  - Ensure `robots.txt` and `sitemap.xml` exist for crawlers.
- [ ] **Accessibility**:
  - **Alt Text**: All `<img>` tags must have `alt` text (We use `cell.character.name`).
  - **Keyboard Nav**: Can you navigate the grid using only `Tab`?
  - **Contrast**: Check text contrast ratios (especially text over images).

### 4. Monitoring & Error Tracking 📈
- [ ] **Error Logging**: Integrate a tool like **Sentry** or **LogRocket**.
  - *Why?* Users won't tell you when the app crashes; Sentry will.
- [ ] **Analytics**: Integrate **Vercel Analytics** or **Google Analytics** (GA4) to understand usage patterns.
- [ ] **404 Page**: Ensure a custom `not-found.tsx` exists to guide lost users back home.

### 5. Legal & Compliance ⚖️
- [ ] **Cookie Consent**: If you use Analytics/Ads, display a Cookie Banner (GDPR/CCPA compliance).
- [ ] **Privacy Policy**: If you collect data (we store mostly locally, but if you add auth later), link to a Privacy Policy.

---

## 🚀 Final Pre-Flight Checklist
1.  **Build**: `bun run build` passes locally with **zero** errors.
2.  **Lint**: `bun run lint` returns clean.
3.  **Tests**: `bun run test` passes all unit tests.
4.  **Clean Start**: `rm -rf .next && bun run dev` starts without caching issues.
5.  **Device Test**: Open the production URL on a **Mobile Device** (iOS/Android) to verify touch interactions and responsive layout.
6.  **Image Search Test**: Search for characters from Anime, VTubers, and Games to verify Serper integration returns accurate results.

**Ready for Liftoff!** 🌌
