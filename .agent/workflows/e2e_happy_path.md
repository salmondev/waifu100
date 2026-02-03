---
description: Automated E2E Happy Path Test for Waifu100
---

# E2E Happy Path Verification

This workflow guides the agent to fully verify the frontend functionality of the Waifu100 application.

## Prerequisites
- Ensure the application is running on `http://localhost:3000`.
- Use a mobile viewport (e.g., 390x844) or Desktop (1920x1080) as specified in steps. Default to **Mobile** for hardest layout checks.

## Step 1: Search & Populate Grid
1. **Open App**: Navigate to `http://localhost:3000`.
2. **Search Anime**:
   - Open Sidebar (Hamburger on mobile).
   - Search for "Frieren" (Anime).
   - Drag "Frieren" result to **Cell 0**.
3. **Search Game**:
   - Search for "2B" (NieR: Automata).
   - Drag "2B" result to **Cell 1**.
4. **Search Vtuber**:
   - Search for "Gawr Gura".
   - Drag "Gura" result to **Cell 2**.
5. **Verify**: Check that Cells 0, 1, and 2 are occupied by the correct characters.

## Step 2: Custom Images
1. **Paste URL**:
   - Open Sidebar -> Click "Paste URL".
   - Enter: `https://placehold.co/400/orange/white.png?text=Custom`
   - Click "Add Image".
   - Drag the resulting "New Character" (or from Gallery/Search if focused) to **Cell 3**.
   - *Note*: If dragging from "Selected" preview is hidden on mobile, verify correct flow (e.g., it auto-adds or appears in gallery).
2. **Mock Upload**:
   - *Agent Instruction*: Use `execute_browser_javascript` to simulate a file upload event on the hidden file input if UI interaction is complex.
   - OR: Click "Upload Image" button and allow agent to simulate input set.
   - Drag uploaded char to **Cell 4**.

## Step 3: Grid Manipulation (& Drag Smoothness)
1. **Swap**: Drag **Cell 0** (Frieren) to **Cell 1** (2B).
   - *Expectation*: Frieren is now at [1], 2B is at [0].
2. **Replace**:
   - Search "Naruto".
   - Drag "Naruto" to **Cell 2** (Gura).
   - *Expectation*: "Replace Character?" Modal appears.
   - Click "Confirm" (or "Replace").
   - *Result*: Cell 2 is now Naruto.
3. **Delete**:
   - Drag **Cell 4** (Uploaded) to the **Bottom Trash Zone** ("Drop to Remove").
   - *Result*: Cell 4 is empty.

## Step 4: Persistence (Save/Load)
1. **Save**:
   - Click "Save / Load" (floppy disk icon).
   - Click "Copy to Clipboard" OR verify the JSON data string generation.
   - *Agent Instruction*: Extract the text from the textarea.
   - Close Modal.
2. **Clear Grid**:
   - *Agent Instruction*: Refresh page or use JS to clear `localStorage` (`waifu100-grid`).
   - Reload Page.
   - Verify Grid is empty.
3. **Load**:
   - Click "Save / Load".
   - Switch to "Load" tab.
   - Paste the saved JSON string.
   - Click "Load Data".
   - *Result*: Grid should restore Frieren, 2B, Naruto, Custom Image in their (swapped) positions.

## Step 5: Export
1. **Export Image**:
   - Click "Download / Export" (image icon).
   - Wait for generation.
   - *Verification*: Check for `browser_download` event or check console for "Export success" message.

## Step 6: UX/UI Audit
1. **Responsiveness**: Resize window to Desktop (1024x768) and back to Mobile. Ensure layout adapts (Sidebar becomes permanent vs drawer).
2. **Smoothness**: During steps 1-3, report if "Drop to Remove" zone flickers or if items get stuck.

---
**Run Instructions**:
Execute this workflow using `browser_subagent`. Break it down into chunks if necessary (e.g., "Step 1 & 2", then "Step 3 & 4").
