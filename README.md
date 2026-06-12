# 🎲 Fortuna v1.0.0

Honest dice for SillyTavern. JavaScript rolls (crypto RNG with real rejection
sampling); the model only narrates. Every roll leaves a receipt.

## The Fates
- **Clotho** — action die. Resolves the turn's primary attempted action.
- **Lachesis** — intensity die. How boldly NPCs act (cautious → daring).
- **Atropos** — event die. Outside complications. The event table is resolved
  in JS — only the *outcome* is injected, never a lookup task.
- **Surplus pool** — 5 unlabeled d20s for additional checks, consumed strictly
  in order. If exhausted, minor actions resolve as routine. No invented dice, ever.

## Rules baked in
- **Failure forks, never walls.** Every failed roll must open a path —
  complication, revelation, pressure, opportunity. Disco Elysium rule, always on.
- Mechanics stay invisible in prose. Receipts stay visible under messages.
- Skips quiet/impersonate generations (won't salt utility calls or Echo).

## Install
Drop the `Fortuna` folder into
`public/scripts/extensions/third-party/` and enable in Extensions.

## Use
- 🎲 FAB (draggable) → panel: enable, difficulty (Casual +2 / Normal / Hard −2),
  Atropos cadence (every turn weighted / rare / off), per-chat scene snooze,
  pre-roll next turn.
- Tap a roll chip under any AI message to see the full cast for that turn.
- `/fortuna-roll 3d6` — honest dice on demand (returns total, pipeable).
- `/fortuna-snooze` — toggle scene snooze.
- `/fortuna-debug` — state toast.

## Roadmap
- v1.1 — **Eris events**: chaos variables generated against your world's
  fractures (LexiconAPI), stored extension-local, fired by Atropos ranges.
- Future — **Codex bridge**: wounds/stress → DC modifiers.
