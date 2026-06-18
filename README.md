# 🎲 Fortuna v2.0.0

Honest dice for SillyTavern. JavaScript rolls (crypto RNG with real rejection
sampling); the model only narrates. Every roll leaves a receipt.

Fortuna owns **magnitude** — *how well* an attempt lands. It never decides
*which* action a character takes or *where* the plot goes; that belongs to the
triad (Chronicler / Codex / Lexicon). Fortuna reads them and rolls.

## The Fates
- **Clotho** — action die. The raw d20 for the turn's primary attempted action.
- **Lachesis** — intensity die. How boldly NPCs act (cautious → daring).
- **Atropos** — event die. Outside complications, resolved in JS — only the
  *outcome* is injected, never a lookup task.
- **Surplus pool** — 5 unlabeled d20s for additional checks, consumed strictly
  in order. If exhausted, minor actions resolve as routine. No invented dice.

## The resolution contract (v2)
The model commits these in its reasoning **before** it writes prose:

1. **DC** from a fixed nine-rung ladder — Trivial 6 → Impossible 18. One pinned
   number, never a range.
2. **Stakes, committed before the die is read** — the core cost of failure, plus
   a reversibility flag: **OPEN** (retry exists) / **FRAGILE** (retry exists but
   degrades) / **TERMINAL** (no second attempt — the dropped vase). This is the
   load-bearing trick: commit the risk before you know the result and it can't be
   quietly talked smaller afterward.
3. **Modifier as "skill"** — the DC is fixed; context enters as a bounded ± on the
   roll. Read live from the triad when present: Codex disposition + emotional
   state, Chronicler world phase. A card's default "shy" loses to real frustration
   because the *state* sets the bend, not the card.
4. **Eight outcome bands** by margin — the margin is the *blast radius* of the
   cost, never whether the core failure happens.
5. **A fence** scoped to the resolved attempt only: no convenient rescue, no
   unearned mercy, no retry on terminal stakes. It never touches arc direction
   (Chronicler) or how anyone feels (Codex). Failure may simply cost.

## Triad integration (all optional, read-only, defensive)
- `CodexAPI.getActiveState` / `getEmotionalState` → the modifier.
- `ChroniclerAPI.getActiveRung` → world-phase bend.
- `CodexAPI.getLoadedThreads` → where a failure's cost prefers to land.

Absent siblings degrade silently to the difficulty dial alone — Fortuna runs
standalone. Fortuna **never** calls a triad write-verb; direction stays theirs.

## Install
Drop the `Fortuna` folder into
`public/scripts/extensions/third-party/` and enable in Extensions.

## Use
- 🎲 FAB (draggable) → panel: enable, difficulty (Casual +2 / Normal / Hard −2),
  Atropos cadence (every turn weighted / rare / off), per-chat scene snooze,
  pre-roll next turn.
- Tap a roll chip under any AI message to see the full cast **and what context
  fed the roll** (difficulty · Codex reading · Chronicler phase).
- `/fortuna-roll 3d6` — honest dice on demand (returns total, pipeable).
- `/fortuna-snooze` — toggle scene snooze.
- `/fortuna-debug` — state toast.

## Roadmap
- **Phase B** — `FortunaAPI.getFlowPressure()` for Chronicler's walker to *read*
  (flood shortens the distance to the next beat, trickle stretches it); JS-tracked
  **fragile** integers via a receipt parser. Both deferred until the contract is
  proven to bind in play.
- **Eris events** — chaos variables generated against your world's fractures
  (LexiconAPI), fired by Atropos ranges.
