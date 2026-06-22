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
- [ ] ⭐ **Meal templates** — save a combo as "My usual breakfast" and log all
      items in one tap. Biggest day-to-day time-saver.
- [ ] **Copy a past day** — extend the day-nav with a "copy this whole day to
      today" button. Trivial given day navigation already exists.
- [ ] **Barcode AI fallback** — when OpenFoodFacts has no match, offer the AI
      describe-estimate inline instead of a dead end.

## 📊 Insights
- [ ] ⭐ **Weight trend + projection** — moving-average trend line and "at this
      rate you'll reach X by [date]" based on the goal.
- [ ] **Photo thumbnails in the log** — the photo flow already captures an image;
      store a small thumbnail so the diary is visual.

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
