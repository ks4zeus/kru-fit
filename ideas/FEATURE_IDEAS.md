# Kru Fit — Feature Ideas / Backlog

A running list of features to build later. Move items to "In progress" / "Done"
as we go. ⭐ = top picks (high daily value or unlocks bigger things).

---

## 🤖 Smart / AI (reuses the existing AI proxy)
- [ ] ⭐ **"What should I eat?"** — given remaining macros for the day + dietary
      prefs, AI suggests a meal that fits ("600 cal / 40g protein left → try…").
      Low effort; same pattern as `/api/coach`.
- [ ] **Weekly AI recap** — Sunday "your week in review" (trends, wins, one focus
      for next week). Pairs with the weigh-in reminder.
- [x] **Recipe builder** — type/dictate ingredients + servings → AI computes
      per-serving macros → saved recipe library, log servings. (shipped 2026-06-20)
- [x] **Scan ingredients into a recipe** — barcode-scan items into the recipe
      builder with an adjustable per-ingredient amount/unit; total auto-sums
      scanned (exact) + AI freeform, ÷ servings. Persists structured items via a
      new `custom_foods.recipe_items` column. (shipped 2026-06-22)
- [x] **Photo portion adjustment** — the AI estimates the whole plate; a portion
      control (¼/½/¾/All + custom multiplier) rescales the macros live before
      logging, so you can log only what you actually ate. (shipped 2026-06-22)

## ⚡ Faster logging
- [x] ⭐ **Meal templates** — save the day's log (or a subset) as a named meal
      from the Today tab; log every item in one tap from a "📋 Your meals"
      section in Quick Add. New `meal_templates` table. (shipped 2026-06-22)
- [ ] **Copy a past day** — extend the day-nav with a "copy this whole day to
      today" button. Trivial given day navigation already exists.
- [ ] **Barcode AI fallback** — when OpenFoodFacts has no match, offer the AI
      describe-estimate inline instead of a dead end.
- [x] **Restaurant search + AI fallback** — Quick Add search also matches a
      curated chain-restaurant seed (MenuStat-style, ~60 items in
      `assets/restaurant-foods.json`), shown under a 🍔 Restaurants section and
      logged with the brand as source; an "✨ Estimate with AI" action is always
      offered as the fallback (existing `/analyze`). No separate button, no new
      API/key — static asset searched client-side; expandable. (shipped 2026-06-22)

## 📊 Insights
- [x] **Admin usage dashboard** — hidden admin-only 📊 tab: per-user tool usage
      (from `food_log.source`), activity (entries/active days/last-seen), and AI
      tokens + cost, plus app-wide totals. `ADMIN_EMAILS` gating, new `ai_usage`
      table recording tokens on every `/analyze` & `/coach` call. (shipped 2026-06-22)
- [x] ⭐ **Weight trend + projection** — moving-average trend line and "at this
      rate you'll reach X by [date]" against a persisted goal weight. (shipped 2026-06-22)
- [ ] **Photo thumbnails in the log** — the photo flow already captures an image;
      store a small thumbnail so the diary is visual.

## 💪 Fitness
- [x] **Exercise tracker** — 💪 Exercise tab: log workouts (activity + minutes,
      MET×weight calorie estimate, editable), summary tiles, calories-burned &
      active-minutes charts, recent-workouts list. New `workouts` table; tracked
      separately from the food calorie ring. (shipped 2026-06-22)
- [x] **Exercise in Insights** — when workouts are logged in the window, the
      Insights tab + AI coach include them; ignored entirely when none. (shipped 2026-06-22)
- [x] **Calorie estimate L1 — intensity tiers** — easy/moderate/hard METs per
      activity, selector in the log form. (shipped 2026-06-22)
- [x] **Calorie estimate L2 — distance-based** — Running/Walking/Hiking/Cycling
      get an optional distance (mi/km) → coefficient×weight×distance, pace-
      independent. New `workouts.distance` column. (shipped 2026-06-22)

## 🧠 Adaptive TDEE (observed maintenance) — roadmap
- [x] **L3 — observed maintenance** — Insights card: maintenance ≈ avg intake −
      (smoothed weight slope × 3500/lb or 7700/kg), gated on enough data, vs goal. (shipped 2026-06-22)
- [x] **Confidence level** — Low/Med/High tier + ✓/⚠ checklist (day span [×2],
      weigh-ins, food logs) on the maintenance card. (shipped 2026-06-22)
- [ ] ⭐ **Predicted vs Observed** — table comparing Mifflin-St Jeor (from the
      macro calculator) to observed maintenance + the difference. Needs the
      calculator filled; note the activity-multiplier assumption (usual reason
      they differ). Cheap; mostly plumbing.
- [ ] **Blend when sparse** — weighted average `predicted×(1−w) + observed×w`,
      where w grows with DATA QUALITY (reuse the confidence inputs, not calendar
      days). Relabel the headline "Estimated maintenance" and keep raw observed +
      confidence visible. Falls back to pure observed if no predicted prior.
- [ ] **Auto-suggest goals** — from the trusted maintenance number, list rate
      targets (−500/day ≈ 1 lb/wk; −1100 ≈ 1 kg/wk) as **tappable** rows that set
      the calorie goal. Safety floor (reuse calculator's BMR×1.05 / 1200–1500);
      gate on confidence ≥ Medium.
- Note: observed TDEE is only as accurate as food logging, but a *consistent*
  logging bias self-corrects for goal-setting (goals live in the same logged-
  calorie frame), so weight change still comes out right — worth a 1-line
  disclaimer on the card.

## 📱 Platform / polish
- [x] ⭐ **Install as an app (PWA)** — manifest + 192/512/maskable icons,
      service worker (network-first HTML, /api bypassed, offline shell), iOS
      standalone meta, and a header Install button. (shipped 2026-06-22)
- [ ] **Push notifications** — true weekly weigh-in / meal reminders even when the
      app is closed (service worker + scheduled Cloudflare Worker + VAPID).
      Currently implemented as an in-app reminder only.
- [ ] **Text food search** — search OpenFoodFacts by name, not just barcode scan.
- [ ] **Fasting / eating-window timer**.

---

## Next up (the original Top 4 are all shipped)
1. **Predicted vs Observed** — next step in the Adaptive TDEE roadmap; cheap.
2. **"What should I eat?"** — remaining-macro meal suggester (last easy AI win).
3. **Blend** + **Auto-suggest goals** — finish the Adaptive TDEE chain.
4. Grab-bag: Copy-a-past-day, Barcode AI fallback, Text food search.

## Notes
- All AI features share the server-side Anthropic key via the Worker/Pages
  Function; no new key needed.
- Voice-to-text (already shipped on Custom Food) is browser-native = zero tokens.
