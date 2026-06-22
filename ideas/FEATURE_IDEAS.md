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

## 📊 Insights
- [x] **Admin usage dashboard** — hidden admin-only 📊 tab: per-user tool usage
      (from `food_log.source`), activity (entries/active days/last-seen), and AI
      tokens + cost, plus app-wide totals. `ADMIN_EMAILS` gating, new `ai_usage`
      table recording tokens on every `/analyze` & `/coach` call. (shipped 2026-06-22)
- [ ] ⭐ **Weight trend + projection** — moving-average trend line and "at this
      rate you'll reach X by [date]" based on the goal.
- [ ] **Photo thumbnails in the log** — the photo flow already captures an image;
      store a small thumbnail so the diary is visual.

## 💪 Fitness
- [x] **Exercise tracker** — 💪 Exercise tab: log workouts (activity + minutes,
      MET×weight calorie estimate, editable), summary tiles, calories-burned &
      active-minutes charts, recent-workouts list. New `workouts` table; tracked
      separately from the food calorie ring. (shipped 2026-06-22)

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

## Top 4 to start with
1. "What should I eat?" (remaining-macro meal suggester)
2. Meal templates
3. PWA install (unlocks home-screen + future push)
4. Weight trend / projection

## Notes
- All AI features share the server-side Anthropic key via the Worker/Pages
  Function; no new key needed.
- Voice-to-text (already shipped on Custom Food) is browser-native = zero tokens.
