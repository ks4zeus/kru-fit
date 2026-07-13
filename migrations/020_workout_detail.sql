-- Detailed strength/workout tracking: per-exercise sets (reps/weight/etc.) attached
-- to an existing workouts (exercise_log) session, plus saveable workout templates.
-- Apply to the live D1 database:
--   wrangler d1 execute kru-fit-db --remote --file=migrations/020_workout_detail.sql

CREATE TABLE workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  workout_id INTEGER NOT NULL,        -- FK -> workouts.id (the session)
  exercise_name TEXT NOT NULL,
  exercise_type TEXT DEFAULT 'strength',  -- 'strength' | 'bodyweight' | 'cardio'
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  exercise_id INTEGER NOT NULL,       -- FK -> workout_exercises.id
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  weight_unit TEXT DEFAULT 'lbs',
  distance REAL,
  distance_unit TEXT DEFAULT 'mi',
  duration_seconds INTEGER,
  completed INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workout_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  exercises TEXT NOT NULL,            -- JSON array of {exercise_name, exercise_type, default_sets, default_reps, default_weight, default_weight_unit}
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX idx_workout_templates_user ON workout_templates(user_id);
