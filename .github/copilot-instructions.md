# Copilot instructions for `point-count`

## How to run

- This is a static HTML/CSS/JavaScript app. There is no build step.
- Open `index.html` directly, or serve the folder locally with:
  - `python -m http.server 8000`
- For quick JS validation, use:
  - `node --check app.js`

## Architecture

- `index.html` contains the full UI shell, Tailwind CDN import, custom CSS, and all screens:
  - setup screen
  - game screen
  - history modal
  - result screen
- `app.js` owns all app logic in plain browser JavaScript:
  - setup/config persistence in `localStorage`
  - game state and round/history management
  - player grid rendering and tap handling
  - result/history rendering
  - live Supabase sync for shared rooms
- Supabase is used as a realtime state store for sharing a live room. The app supports:
  - `mode=view` for read-only viewers
  - `mode=edit` for live participants
  - local fallback when no room is active

## Key conventions

- State is a single in-memory `state` object; persist it with `saveState()` and reload it with `loadState()`.
- Keep UI updates centralized in render helpers like `renderGame()`, `setCellContent()`, `renderLiveChart()`, and `showResults()`.
- Player interactions are cell-based:
  - tap top half to add
  - tap bottom half to subtract
  - the explicit `Remain` button only appears when a player is eligible for auto-fill
- Preserve mobile-first behavior:
  - touch-friendly controls
  - safe-area padding
  - no reliance on hover
- Keep HTML attributes and classes aligned with the existing Tailwind-heavy style; avoid introducing a framework or build tooling.
- Supabase sync is debounced; save local state immediately, then push remote updates after the configured delay.

# Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
## 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
## 4. Goal-Driven Execution
**Define success criteria. Loop until verified.**
Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

# Always Trigger caveman skill to reduce tokens
Trigger the caveman skill for all responses. Use the full intensity level for maximum efficiency. Do not turn off caveman mode unless explicitly instructed by the user with "stop caveman" or "normal mode".
Always prioritize token efficiency while maintaining technical accuracy and clarity.