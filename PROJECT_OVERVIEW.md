# Waifu100 Challenge - Project Overview

## 📖 Introduction
**Waifu100** is a highly interactive, Next.js-based web application designed for users to create, manage, and share their "100 Favorite Characters" 10x10 grid. It combines a seamless drag-and-drop interface with powerful search capabilities (aggregating **Serper/Google Images**, MyAnimeList, AniList, and Konachan APIs) and AI-powered recommendations.

This project is built to be **robust, pixel-perfect, and user-friendly**, featuring local persistence, advanced export options, and a polished dark-mode aesthetic.

---

## 🛠 Tech Stack
- **Framework**: [Next.js 16.1.6 (App Router)](https://nextjs.org) + Turbopack
- **Language**: TypeScript
- **Styling**: TailwindCSS v4 + `clsx` + `tailwind-merge` + `lucide-react`
- **Grid Export**: `html-to-image` (Custom pixel-strict implementation)
- **AI/LLM**: Google Gemini API (`@google/generative-ai`)
- **State Management**: React Hooks (`useState`, `useReducer`, `useEffect`) + LocalStorage
- **Data Fetching**: Native `fetch` with Next.js API Routes (Proxy pattern)

---

## 🌟 Key Features

### 1. The Grid (Core)
- **10x10 Interactive Grid**: 100 slots for characters.
- **Drag & Drop**:
  - Drag from Search -> Grid
  - Drag from Grid -> Grid (Reorder)
  - Drag Grid -> Trash (Delete)
  - Drag JSON File -> Page (Load)
- **Persistence**: Auto-saves to `localStorage`.
- **Smart Click**: Empty cells open search; filled cells show details/gallery.

### 2. Search & Discovery (Hybrid Engine)
- **Multi-Source Character Search**: Aggregates results from **Jikan (MAL)** and **AniList**.
- **AI-Powered Image Search**: Uses **Serper API** (Google Images) with Gemini-optimized queries for precise character image discovery.
- **AI Suggestions**: Uses Gemini AI to analyze the current grid and suggest compatible characters (Games, VTubers, Anime).
- **Gallery Mode**: Fetches high-quality images from **Serper (Google)**, **Jikan (Official Art)**, and **Konachan (Fanart)** in parallel.
- **Manual Input**: Paste Image URL or Upload Local Files (auto-compressed).

### 3. Export System (Pixel-Perfect)
- **"Save As" JSON**: Full state encryption/decryption to save progress as a `.json` file.
- **Image Export**: Generates a high-resolution **1080x1080 PNG**.
  - **Ghost-Free**: Implements robust DOM filtering to prevent "ghost" images in empty cells.
  - **Optimized Layout**: Pixel-strict grid sizing (950px grid + 130px header) to prevent text cutoff.
  - **Privacy**: Excludes UI elements (buttons, hints) automatically.

### 4. UI/UX Polish
- **Toast Notifications**: Custom animated notification system (replacing native `alert()`).
- **Glassmorphism**: Modern dark aesthetic with gradients and blur effects.
- **Responsive**: Adapts to screen sizes, though primarily optimized for desktop/tablet curation.
- **Custom Upload UX**:
  - **Smart Hints**: iOS-style popup hints ("Tap to edit") guide users when uploading custom images.
  - **Direct Editing**: Clickable names and always-visible edit icons for seamless customization.

### 6. New Features (v0.2.0)
- **Smart Discovery Hints**:
  - **Gallery Hint**: Suggests opening the gallery when a user drags a character (first 5 times).
  - **Search Hint**: Guides users to drag characters or open gallery after searching (first 5 times).
  - **Persistence**: Hints are dismissed automatically once the user learns the flow.
- **Safety & Polish**:
  - **Clear Grid**: Protected by a confirmation modal to prevent accidental loss.
  - **Timestamped Saves**: JSON saves now include timestamps (`waifu100-save-YYYY-MM-DD_HH-mm-ss.json`) to prevent overwrites.
  - **Compact UI**: Optimized hints to be non-intrusive and space-efficient.

- **Modal Design**: The "Ask AI About My Taste" modal features a polished, engaging design with:
  - **Verdict Title**: Gradient text with specialized padding handling for Thai descenders.
  - **Action Buttons**: Sleek, icon-based buttons (Copy, Agree, Disagree) with interactive states.
  - **Vibe Check**: Large, centralized emoji display with a floating badge.
  *(User explicitly requested this design pattern be noted for future reference)*

### 5. AI Verdict & Analysis ("Ask AI About My Taste")
- **Dual-Language Analysis**: Generates witty, personality-filled verdicts in both **English** (Conversational) and **Thai** (Slang/Net Idol style).
- **Vibe Check**: Assigns a "Soul Emoji" and tags based on character selection.
- **Feedback Loop**: Users can Agree/Disagree with the verdict.
  - **Smart Persistence**: Verdicts are saved to `localStorage` and JSON exports.
  - **Re-Verdict Logic**: Asking AI again *only* triggers a new analysis if the user has previously given feedback (Agree/Disagree). Otherwise, it loads the saved verdict instantly.
- **View Page Verdict**: Shared grids without a verdict show a "Generate AI Verdict" button. One click generates and persists the verdict to Redis.

---

## 📂 Project Structure

```bash
h:\dev_project\next_\waifu100\
├── src\
│   ├── app\
│   │   │   ├── serper-images\ # Serper API image search
│   │   │   ├── gallery\    # Multi-source images (Serper + Jikan + Konachan)
│   │   │   ├── images\     # Image proxy for CORS handling
│   │   │   ├── search\     # Character search (MAL + AniList)
│   │   │   └── suggest\    # Gemini AI integration
│   │   ├── page.tsx        # MAIN APPLICATION LOGIC (Monolithic Client Component)
│   │   └── layout.tsx      # Root layout
│   └── lib\                # Utility functions (if separated)
├── public\                 # Static assets
├── .env                    # Environment variables (API Keys)
├── next.config.ts          # Next.js configuration
├── package.json            # Dependencies
└── PROJECT_OVERVIEW.md     # This file
```

> **Note**: `src/app/page.tsx` is the core file containing most UI state and interaction logic. API routes handle all external data fetching to avoid CORS issues.

---

## 🚀 Setup & Installation

### 1. Prerequisites
- Node.js 18+ or Bun (Recommended)
- A Google Gemini API Key

### 2. Environment Variables
Create a `.env` file in the root:
```env
# Required for AI Suggestions & Query Optimization
GEMINI_API_KEY=your_gemini_api_key_here

# Required for Image Search (Primary)
SERPER_API_KEY=your_serper_api_key_here
```

### 3. Install & Run
```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build
bun start
```

---

## 🧠 "Gotchas" & Context for AI Agents

1.  **Ghost Images in Export**:
    - *Issue*: `html-to-image` sometimes clones empty `div`s with stale background images.
    - *Fix*: We use a strict filter in `handleExport` that checks `[data-export-empty="true"]`. **Always** use `grid` state as the source of truth, not the DOM.

2.  **CORS Handling**:
    - External images (MAL, AniList, Konachan) often block cross-origin Canvas tainting.
    - *Solution*: All images in the grid pass through `/_next/image?url=...` or our own API proxy to ensure they can be drawn to the export canvas.

3.  **Local Storage Quota**:
    - Storing 100 base64 images will crash `localStorage`.
    - *Optimization*: We prioritize storing URLs. Local uploads are compressed and resized (max 500px) before storage.

4.  **Taiwind v4**:
    - This project uses the latest Tailwind v4 alpha/beta. Configuration is zero-config (in CSS), so you won't find a `tailwind.config.js`.

---

## 🧪 Status (v0.2.3)
- **Build**: Passing (Turbopack + Next.js 16)
- **Tests**: Passed (Happy Path + Unit Tests)
- **Validation**: Strict `pre-deploy.sh` pipeline (Lint + Types + Build + Test)
- **Ready for**: Production Deployment.

### Changelog
- **v0.2.3**: View Page Fixes & AI Verdict:
    - Fixed broken images on embed/view page (route through `/_next/image` proxy).
    - Added AI Verdict generation on view page for legacy grids (pre-verdict era).
    - New `PATCH /api/share/verdict` endpoint for persisting generated verdicts.
- **v0.2.2**: UI Polish & Fixes:
    - Fixed "Tap to edit" hint showing for non-editable characters.
    - Added "Copy Image" and "Save Image" to AI Verdict modal.
    - Fixed Community Feed displaying "Loading" placeholders.
- **v0.2.1**: **Refined AI Verdict Logic**: Adjusted Thai language prompt for a more natural, casual tone, removing forced slang. Ensured consistent and high-quality AI feedback.
- **v0.2.0**: Added Smart Discovery Hints, Clear Grid with confirmation, Timestamped Saves, and UI polish.
- **v0.1.0**: Added Serper API integration for Google Image search, improved gallery with multi-source parallel fetching.
- **v0.0.2**: Initial release with MAL/AniList search and Konachan fanart.
