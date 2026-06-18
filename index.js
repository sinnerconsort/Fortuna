/**
 * ═══════════════════════════════════════════════════════════════════
 *  FORTUNA v2.0.0 — The Fates roll, the prose obeys.
 * ═══════════════════════════════════════════════════════════════════
 *  Honest dice for SillyTavern. JS rolls (real rejection sampling,
 *  because we keep our promises), the model only narrates.
 *
 *  The three Fates:
 *    • Clotho   — action die (d20). The raw roll for the turn's
 *                 primary attempted action.
 *    • Lachesis — intensity die (d20). How boldly NPCs act.
 *    • Atropos  — event die (d20). Outside complications, resolved
 *                 table-side in JS; only the OUTCOME is injected.
 *  Plus a surplus pool of 5 unlabeled d20s for additional checks —
 *  consumed strictly in order, never reused, never invented.
 *
 *  ── RESOLUTION MODEL (v2 — the rewrite) ──
 *  Fortuna owns MAGNITUDE; the triad owns every DIRECTION. A roll
 *  resolves HOW WELL an attempt lands, never WHICH action is taken
 *  or where the plot goes. The contract the model must transcribe in
 *  its reasoning BEFORE prose:
 *    1. DC from a fixed nine-rung ladder (Trivial 6 … Impossible 18).
 *    2. STAKES committed before the die is read — core cost + a
 *       reversibility flag (OPEN / FRAGILE / TERMINAL). This is the
 *       load-bearing anti-plot-armor mechanic: commit the risk before
 *       you know the result, and you can't lowball it after.
 *    3. MODIFIER as "skill" — the DC is fixed; context enters as a
 *       bounded ± to the ROLL. Read live from the triad if present:
 *       Codex disposition + VAD, Chronicler world phase. Degrades to
 *       the difficulty dial alone if siblings are absent.
 *    4. Eight outcome BANDS by margin (blast radius of the cost),
 *       never softening whether the core happens.
 *    5. A FENCE scoped to THIS resolved attempt only — no convenient
 *       rescue, no unearned mercy, no retry on TERMINAL stakes. Never
 *       touches arc direction (Chronicler) or feelings (Codex).
 *
 *  Triad reads (all optional, all read-only, all defensive):
 *    • CodexAPI    → getActiveState / getEmotionalState  (the modifier)
 *    • ChroniclerAPI → getActiveRung / getActiveEra        (phase ±1)
 *    • CodexAPI    → getLoadedThreads  (where a failure's cost lands)
 *  Fortuna NEVER calls a triad write-verb. Direction stays theirs.
 *
 *  Phase B (not in this file): FortunaAPI.getFlowPressure() for the
 *  Chronicler walker to READ; JS-tracked FRAGILE integers via a
 *  receipt parser. Both deferred until the contract is proven to bind.
 *
 *  v1.1 stub: ERIS EVENTS — world-specific chaos variables generated
 *  via utility call against lore fractures, stored extension-local,
 *  fired by Atropos ranges. (see resolveAtropos comment below)
 *
 *  Mobile-first: FAB on #form_sheld (with trap probe), inline styles,
 *  vanilla-ish JS + jQuery, no console required. Drop-in single file.
 * ═══════════════════════════════════════════════════════════════════
 */

import { getContext, extension_settings } from '../../../extensions.js';

// ── Paranoid plumbing: zero script.js imports. One bad named export
// kills an ES module at link time with no visible error, so everything
// runs through getContext() at call time instead. Enum values hardcoded
// (stable across ST versions).
const PROMPT_IN_CHAT = 1;   // extension_prompt_types.IN_CHAT
const ROLE_SYSTEM = 0;      // extension_prompt_roles.SYSTEM

const ctx = () => getContext();
const ET = () => { const c = ctx(); return c.eventTypes || c.event_types || {}; };
const ES = () => ctx().eventSource;
function chatMeta() {
    const c = ctx();
    const m = c.chatMetadata || c.chat_metadata;
    return m || {};
}
function saveSettingsDebounced() { try { ctx().saveSettingsDebounced(); } catch (e) { /* */ } }
function doSaveChat() {
    const c = ctx();
    try { (c.saveChatDebounced || c.saveChat || (() => {}))(); } catch (e) { /* */ }
}
function stSetExtensionPrompt(...args) {
    const c = ctx();
    if (typeof c.setExtensionPrompt === 'function') c.setExtensionPrompt(...args);
}

const EXT_ID = 'fortuna';
const TAG = '[Fortuna]';
const INJECT_KEY = 'FORTUNA';
const Z = 31000; // house z-index

// ─────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    enabled: true,
    difficulty: 'normal',      // casual | normal | hard
    atroposCadence: 'every',   // every | rare | off
    injectionDepth: 1,         // depth in chat (0 = very end)
    poolSize: 5,
    fabPos: null,              // {right, bottom} persisted drag position
};

const DIFFICULTY_MOD = { casual: 2, normal: 0, hard: -2 };
const DIFFICULTY_LABEL = { casual: 'Casual (+2)', normal: 'Normal (+0)', hard: 'Hard (−2)' };

function settings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
    const s = extension_settings[EXT_ID];
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) s[k] = DEFAULT_SETTINGS[k];
    }
    return s;
}
function saveSettings() { saveSettingsDebounced(); }

// per-chat: snooze flag
function chatState() {
    const m = chatMeta();
    if (!m[EXT_ID]) m[EXT_ID] = { snooze: false };
    return m[EXT_ID];
}
function saveChatState() { doSaveChat(); }

// ─────────────────────────────────────────────────────────────────
// Honest randomness (rejection sampling — the real kind)
// ─────────────────────────────────────────────────────────────────

function rollDie(sides) {
    const limit = Math.floor(0x100000000 / sides) * sides;
    const buf = new Uint32Array(1);
    let v;
    do {
        crypto.getRandomValues(buf);
        v = buf[0];
    } while (v >= limit);
    return (v % sides) + 1;
}

function rollFates(s) {
    return {
        clotho: rollDie(20),
        lachesis: rollDie(20),
        atropos: rollDie(20),
        pool: Array.from({ length: s.poolSize }, () => rollDie(20)),
        difficulty: s.difficulty,
        cadence: s.atroposCadence,
        ts: Date.now(),
        pinned: false,
    };
}

// ─────────────────────────────────────────────────────────────────
// Atropos — event table resolved in JS, outcome-only injection
// ─────────────────────────────────────────────────────────────────

function resolveAtropos(z, cadence) {
    // v1.1 ERIS HOOK: before the generic table, check extension-local
    // chaos variables for this character; if one's range matches z,
    // return its bespoke event text instead. (generated via utility
    // call against LexiconAPI.getLoreContextBlock world fractures)
    if (cadence === 'off') return null;

    if (cadence === 'rare') {
        if (z === 18) return 'a brief environmental interruption reaches the scene (a knock, a noise, a turn in the weather)';
        if (z === 19) return 'an unexpected opportunity briefly presents itself to someone present';
        if (z === 20) return 'a complication from off-screen lands in the scene';
        return null;
    }

    // 'every' — calm-weighted full table
    if (z <= 8) return null;
    if (z <= 10) return 'a minor background incident occurs nearby (mundane, brief, off to the side)';
    if (z <= 12) return "one present character's mood shifts for a private, plausible reason";
    if (z <= 14) return 'an absent character arrives — only if plausible and the scene allows; otherwise nothing happens';
    if (z <= 16) return "a rumor, message, or overheard detail reaches someone it shouldn't";
    if (z <= 18) return 'a brief environmental interruption reaches the scene (a knock, a noise, a turn in the weather)';
    if (z === 19) return 'an unexpected opportunity briefly presents itself to someone present';
    return 'a complication from off-screen lands in the scene';
}

// ─────────────────────────────────────────────────────────────────
// Injection
// ─────────────────────────────────────────────────────────────────

function lachesisBand(y) {
    if (y <= 7) return 'cautious / guarded';
    if (y <= 14) return 'assertive / forward';
    return 'bold / daring, possibly reckless';
}

// ─── Codex bridge: aim events at loaded threads ──────────────────────────────
// Atropos still decides IF an event happens and its type/severity, in JS. Codex
// only supplies WHAT the complication can attach to — the thread the story is
// actually carrying — so bigger events land on loaded ground instead of random
// ground. Degrades silently to generic events if Codex is absent or has nothing.
function topLoadedThread() {
    try {
        const api = window.CodexAPI;
        if (!api || api.isActive?.() === false) return null;

        let list = null;
        if (typeof api.getLoadedThreads === 'function') {
            list = api.getLoadedThreads(3);                 // already ranked
        } else if (typeof api.getActiveThreads === 'function') {
            // Fallback for older Codex: rank locally (climax > escalating > building, primary first).
            const w = { climax: 2, escalating: 1, building: 0 };
            list = (api.getActiveThreads() || []).slice().sort((a, b) => {
                const pa = a.priority === 'primary' ? 1 : 0;
                const pb = b.priority === 'primary' ? 1 : 0;
                if (pb !== pa) return pb - pa;
                return (w[b.status] ?? 0) - (w[a.status] ?? 0);
            });
        }
        return Array.isArray(list) && list.length ? list[0] : null;
    } catch (e) {
        return null;
    }
}

// The fixed DC ladder — DE difficulty names, one pinned number each (NOT ranges;
// a single value is strictly more binding than "pick something in 11-15"). The
// top rungs sit a pip apart on purpose — they only separate once modifiers swing.
const DC_LADDER = 'Trivial 6 · Easy 8 · Medium 10 · Challenging 12 · Formidable 13 · Legendary 14 · Heroic 15 · Godly 16 · Impossible 18';

// ─── Triad readers — all optional, all read-only, all defensive ──────────────
// Fortuna reads the triad's NOUNS (a disposition, a phase, a thread) and turns
// them into a bounded ± on the ROLL. It never reads or calls a write-verb, and
// every reader degrades to null the instant a sibling is absent or mid-load.

function readCodex() {
    try {
        const api = window.CodexAPI;
        if (!api || api.isActive?.() === false) return null;
        const state = api.getActiveState?.() || null;   // { name, express, suppress }
        const vad = api.getEmotionalState?.() || null;   // { valence, arousal, dominance, label }
        if (!state && !vad) return null;
        // Codex models ONE character. Capture WHOSE state this is so the modifier
        // can be attributed and gated — otherwise the model thrashes on "whose
        // number is this?" in any multi-actor scene. Best-effort from ST context.
        let focal = '';
        try {
            const c = ctx();
            focal = c?.name2 || c?.characters?.[c?.characterId]?.name || '';
        } catch (_) { /* */ }
        return { state, vad, focal };
    } catch (e) { return null; }
}

function readChronicler() {
    try {
        const api = window.ChroniclerAPI;
        if (!api || api.isActive?.() === false) return null;
        const rung = api.getActiveRung?.() || null;      // { title, genre, situation, ... }
        if (!rung || !rung.title) return null;
        return { title: rung.title, genre: rung.genre || '' };
    } catch (e) { return null; }
}

// Builds the MODIFIER section. The difficulty dial is JS-fixed and always shown
// (itemizable, even at +0). Codex/Chronicler lines appear only when present, so
// the block is honest about exactly what fed the roll this turn.
function buildModifierLines(roll, codex, chron) {
    const dial = DIFFICULTY_MOD[roll.difficulty] ?? 0;
    const lines = [`    · Difficulty dial: ${dial >= 0 ? '+' + dial : dial} (player-set; applies to every check this turn).`];

    if (codex?.state || codex?.vad) {
        const who = codex.focal || 'the character Codex is tracking';
        lines.push(`    · SUBJECT — the reading(s) below describe ${who} ONLY. Apply them solely to ${who}'s own action. If a DIFFERENT character takes the resolved action, ignore them and use the dial + phase alone. If a reading plainly contradicts what ${who} is doing in the scene, trust the scene and omit it. (Codex models one character; do not spread these onto others.)`);
        if (codex.state) {
            const exp = codex.state.express ? ` — expresses: "${codex.state.express}"` : '';
            lines.push(`    · ${who}'s disposition "${codex.state.name}"${exp}. If ${who} acts IN LINE with this, +2; AGAINST it (suppressing it), −2.`);
        }
        if (codex.vad) {
            const v = codex.vad;
            lines.push(`    · ${who}'s emotional state: ${v.label || 'neutral'} (valence ${v.valence}, arousal ${v.arousal}, dominance ${v.dominance}). Strong feeling drives the body — if ${who} pushes toward this drive, easier (up to +3); if forced against it, harder (down to −3). This is how a card's default "shy" loses to real frustration: the state, not the card, sets the bend.`);
        }
    }
    if (chron) {
        lines.push(`    · World phase "${chron.title}"${chron.genre ? ` (${chron.genre})` : ''}: a check may bend ±1 toward the phase's pressure (applies to any actor).`);
    }
    if (!codex && !chron) {
        lines.push('    · No Codex or Chronicler readings reached Fortuna this turn — resolve on the dial and plain context alone.');
    }
    return lines.join('\n');
}

function buildInjection(roll) {
    const codex = readCodex();
    const chron = readChronicler();
    const modLines = buildModifierLines(roll, codex, chron);

    // Stash what fed the roll onto the roll object, so the receipt chip can audit
    // Fortuna's INPUTS (the receipts principle, applied to context not just dice).
    roll.context = {
        difficulty: roll.difficulty,
        codex: codex ? (codex.state?.name || codex.vad?.label || 'present') : null,
        chronicler: chron ? chron.title : null,
    };

    const eventText = resolveAtropos(roll.atropos, roll.cadence);
    // Anchor only the plot-ish tiers (rumor / interruption / opportunity /
    // complication — z >= 15). Small ambient events stay incidental.
    let anchor = '';
    if (eventText && roll.atropos >= 15) {
        const t = topLoadedThread();
        if (t && t.name) {
            anchor = ` If it can plausibly touch the open thread "${t.name}"${t.status ? ` (${t.status})` : ''}, let it land there; otherwise keep it incidental.`;
        }
    }
    const atroposLine = eventText
        ? `• Atropos (event die): this turn, ${eventText}.${anchor} Weave it in naturally; skip it silently if it would break the scene's tone or intimacy.`
        : '• Atropos (event die): the thread holds — no outside event this turn.';

    // Where a failure's situational cost should land, if the story is carrying a thread.
    const land = topLoadedThread();
    const landLine = (land && land.name)
        ? `• When a failure's cost spills into the situation (SETBACK or worse), prefer to land it on the open thread "${land.name}"${land.status ? ` (${land.status})` : ''} rather than inventing an unrelated complication.`
        : '';

    return [
        '<fortuna>',
        'THE FATES HAVE ALREADY ROLLED. These dice are pre-rolled and immutable — never invent, alter, re-roll, or ignore a die.',
        `• Clotho (action die): ${roll.clotho}/20 — the raw roll for THIS turn's primary attempted action (any character's).`,
        `• Lachesis (intensity die): ${roll.lachesis}/20 — NPC initiative this turn: ${lachesisBand(roll.lachesis)}.`,
        atroposLine,
        `• Surplus pool for ADDITIONAL checks beyond the first: [${roll.pool.join(', ')}]. Consume strictly left to right, one die per extra check, never reuse a die. If the pool runs out, remaining minor actions resolve as routine — do not invent new dice.`,
        '',
        '══ RESOLUTION — for any action with a real chance of failure (ordinary talk needs no roll) ══',
        'Work these five steps in your reasoning BEFORE writing prose, in order. Do not narrate until all five are committed.',
        '',
        '1 ▸ ACTION — name the single primary action this die resolves. (If several characters act independently this turn, Clotho resolves the most consequential action; each further independent action draws the next surplus-pool die, in order. One die never covers two actors.)',
        `2 ▸ DC — set the target from the task's base difficulty. One pinned value, never a range:`,
        `      ${DC_LADDER}`,
        '3 ▸ STAKES — commit NOW, before reading the die. What does success get? What does failure COST at its core? Then flag reversibility:',
        '      OPEN — a later retry or a new angle exists.',
        '      FRAGILE — a retry exists, but every failed attempt degrades the thing; it will not last forever.',
        '      TERMINAL — no second attempt (a dropped vase, a spoken word, a fall). Once failed, it stays failed.',
        '      This commitment is BINDING. After the die is read you may not lower the stakes, shrink the cost, or change the flag. (Committing the risk before you know the result is what stops a failure from being quietly talked smaller.)',
        '4 ▸ MODIFIER — the DC is fixed; CONTEXT enters as a ± on the ROLL (+ when context favors the actor, − when it opposes). Sum, itemize each, cap the total at ±5:',
        modLines,
        '      Natural 1 and natural 20 ignore ALL modifiers — judged on the raw die.',
        '5 ▸ RESOLVE — total = Clotho (or the next pool die) + modifier. Compare to DC. Read the band:',
        '      SUCCESS (total ≥ DC): margin 0–1 MARGINAL (works, with a small friction even so) · 2–5 CLEAN (works as intended) · 6+ STRONG (works, plus an edge worth banking) · nat 20 CRITICAL (beyond what was asked).',
        '      FAILURE (total < DC): margin 1–2 GLANCE (fails; cost falls on the attempt — time, position, a resource; OPEN stakes stay open) · 3–6 SETBACK (fails; cost falls on the situation — ground lost, a complication born FROM the failure; the approach must change) · 7+ COLLAPSE (fails hard; cost falls on something load-bearing — and an OPEN window may slam to TERMINAL here) · nat 1 DISASTER (something breaks beyond the attempt itself).',
        '      The margin is the BLAST RADIUS — how much breaks AROUND the core — never whether the core happens. The reversibility flag, not the margin, decides retries.',
        '',
        '══ THE FENCE — governs THIS resolved attempt only ══',
        '• Honor the committed stakes and the band. A failure fails for real: the door stays locked, the blow misses, the vase breaks.',
        '• Forbidden as rescues of a failed attempt: a convenient interruption, an NPC or the environment stepping in to spare the cost, unearned mercy, a second chance with no fresh roll, or quietly shrinking what was at stake. If you catch yourself writing one, the turn is invalid — rewrite it as the failure landing.',
        '• A fresh attempt is allowed only on OPEN stakes, on a later turn, with a new roll. TERMINAL stakes — and any OPEN window a COLLAPSE slammed shut — get no retry.',
        "• This fence touches RESOLUTION only. It does not dictate where the story goes, how anyone FEELS about the outcome, or whether unrelated events occur — those belong to the world and the characters, not to this die. Failure may simply cost; it owes no silver lining, and not every failure needs a new door.",
        eventText ? '• An Atropos event may still occur this turn, but it must never function as a rescue of a failed attempt.' : '',
        landLine,
        '',
        'Never announce dice, DCs, margins, or band names in the prose — the fiction stays seamless. Leave exactly one audit line in your reasoning:',
        '      FORTUNA ▸ <action> | DC <n> <tier> | <die> <±mods itemized> = <total> | <BAND> | <core cost> [<FLAG>]',
        '</fortuna>',
    ].filter(Boolean).join('\n');
}

function applyInjection(roll) {
    const s = settings();
    try {
        stSetExtensionPrompt(
            INJECT_KEY,
            buildInjection(roll),
            PROMPT_IN_CHAT,
            s.injectionDepth,
            false,
            ROLE_SYSTEM,
        );
    } catch (e) {
        console.error(TAG, 'injection failed', e);
    }
}

function clearInjection() {
    try { stSetExtensionPrompt(INJECT_KEY, '', PROMPT_IN_CHAT, 0); } catch (e) { /* */ }
}

// ─────────────────────────────────────────────────────────────────
// Generation lifecycle
// ─────────────────────────────────────────────────────────────────

let pendingRoll = null;   // roll consumed by the next received message
let pinnedRoll = null;    // user pre-rolled via panel; takes priority once

const SKIP_TYPES = new Set(['quiet', 'impersonate']); // don't salt utility calls or Echo

function onGenerationAfterCommands(type, _options, dryRun) {
    try {
        if (dryRun) return;
        const s = settings();
        if (!s.enabled || chatState().snooze || SKIP_TYPES.has(type)) {
            clearInjection();
            if (!SKIP_TYPES.has(type)) pendingRoll = null;
            return;
        }
        pendingRoll = pinnedRoll || rollFates(s);
        pinnedRoll = null;
        updatePanelPinned();
        applyInjection(pendingRoll);
    } catch (e) {
        console.error(TAG, 'onGenerationAfterCommands', e);
    }
}

function onMessageReceived(mesId) {
    try {
        if (!pendingRoll) return;
        const c = ctx();
        const message = c?.chat?.[mesId];
        if (!message || message.is_user) return;

        if (!message.extra) message.extra = {};
        message.extra[EXT_ID] = pendingRoll;

        // per-swipe receipts
        const swipeId = message.swipe_id ?? 0;
        if (!message.extra[EXT_ID + '_swipes']) message.extra[EXT_ID + '_swipes'] = {};
        message.extra[EXT_ID + '_swipes'][swipeId] = pendingRoll;

        pendingRoll = null;
        saveChatState();
    } catch (e) {
        console.error(TAG, 'onMessageReceived', e);
    }
}

function onMessageSwiped(mesId) {
    try {
        const c = ctx();
        const message = c?.chat?.[mesId];
        if (!message) return;
        const swipeId = message.swipe_id ?? 0;
        const stored = message.extra?.[EXT_ID + '_swipes']?.[swipeId];
        if (stored && message.extra) message.extra[EXT_ID] = stored;
        renderChipFor(mesId);
    } catch (e) { /* non-critical */ }
}

// ─────────────────────────────────────────────────────────────────
// Receipts — the roll chip
// ─────────────────────────────────────────────────────────────────

const CHIP_BASE = 'display:inline-flex;align-items:center;gap:6px;margin:4px 0 0 0;padding:2px 9px;border-radius:11px;font-size:11px;line-height:1.5;opacity:0.75;cursor:pointer;background:rgba(120,100,160,0.16);border:1px solid rgba(160,140,200,0.25);user-select:none;max-width:100%;';
const DETAIL_BASE = 'display:none;margin-top:4px;padding:6px 10px;border-radius:8px;font-size:11px;line-height:1.7;background:rgba(20,16,30,0.45);border:1px solid rgba(160,140,200,0.2);';

function chipHtml(roll, snoozedAtTime) {
    if (!roll) return '';
    const eventText = resolveAtropos(roll.atropos, roll.cadence);
    const aShort = eventText ? `A${roll.atropos}✂` : `A${roll.atropos}`;

    // Context badges — what fed the roll (receipts principle, applied to inputs).
    const cx = roll.context || {};
    const badges = [];
    if (cx.codex) badges.push(`🧠 ${cx.codex}`);
    if (cx.chronicler) badges.push(`📖 ${cx.chronicler}`);
    const badgeShort = badges.length ? `<span style="opacity:0.6">· ${badges.join(' · ')}</span>` : '';
    const fedRow = (cx.codex || cx.chronicler)
        ? `<div style="opacity:0.65">Fed the roll: ⚙ ${DIFFICULTY_LABEL[roll.difficulty] || roll.difficulty}${cx.codex ? ` · 🧠 Codex: ${cx.codex}` : ''}${cx.chronicler ? ` · 📖 ${cx.chronicler}` : ''}</div>`
        : `<div style="opacity:0.5">Fed the roll: ⚙ ${DIFFICULTY_LABEL[roll.difficulty] || roll.difficulty} · no triad readings reached Fortuna</div>`;

    return `
        <div class="fortuna-chip" style="${CHIP_BASE}" title="Fortuna — tap for the full cast">
            <span>🎲</span>
            <span>C${roll.clotho} · L${roll.lachesis} · ${aShort}</span>
            ${badgeShort}
            <span style="opacity:0.6">▾</span>
        </div>
        <div class="fortuna-detail" style="${DETAIL_BASE}">
            <div><b>Clotho</b> (action): ${roll.clotho}/20</div>
            <div><b>Lachesis</b> (intensity): ${roll.lachesis}/20 — ${lachesisBand(roll.lachesis)}</div>
            <div><b>Atropos</b> (event): ${roll.atropos}/20 — ${eventText ? eventText : 'the thread holds'}</div>
            <div><b>Pool</b>: [${roll.pool.join(', ')}]</div>
            ${fedRow}
            <div style="opacity:0.65">Difficulty: ${DIFFICULTY_LABEL[roll.difficulty] || roll.difficulty}${roll.pinned ? ' · pre-rolled' : ''}</div>
        </div>`;
}

function renderChipFor(mesId) {
    try {
        const c = ctx();
        const message = c?.chat?.[mesId];
        const $mes = $(`#chat .mes[mesid="${mesId}"]`);
        if (!$mes.length) return;
        $mes.find('.fortuna-chip, .fortuna-detail').remove();
        if (!message || message.is_user || message.is_system) return;
        const roll = message.extra?.[EXT_ID];
        if (!roll) return;
        const $block = $mes.find('.mes_text').first();
        if (!$block.length) return;
        $block.after(chipHtml(roll));
    } catch (e) { /* non-critical */ }
}

function renderAllChips() {
    try {
        const c = ctx();
        if (!c?.chat) return;
        $('#chat .mes').each(function () {
            const mesId = Number($(this).attr('mesid'));
            if (!Number.isNaN(mesId)) renderChipFor(mesId);
        });
    } catch (e) { /* non-critical */ }
}

// chip expand/collapse (delegated — survives re-renders)
$(document).on('click', '.fortuna-chip', function () {
    $(this).next('.fortuna-detail').toggle();
});

// ─────────────────────────────────────────────────────────────────
// FAB + panel (mobile-first, inline styles, trap probe mount)
// ─────────────────────────────────────────────────────────────────

const FAB_STYLE = `position:fixed;left:0;top:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#5a4a7a,#2e2542);color:#e8e0f5;border:2px solid rgba(212,175,55,0.75);box-shadow:0 2px 8px rgba(0,0,0,0.45);z-index:${Z};display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;touch-action:none;`;
const PANEL_STYLE = `position:fixed;left:0;top:0;width:min(280px, calc(100vw - 20px));background:rgba(24,19,36,0.97);border:1px solid rgba(180,160,220,0.35);border-radius:12px;padding:12px;z-index:${Z};color:#e8e0f5;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.55);display:none;`;
const ROW = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;';
const SELECT = 'background:#1c1530;color:#e8e0f5;border:1px solid rgba(180,160,220,0.3);border-radius:6px;padding:3px 6px;font-size:12px;max-width:140px;';
const BTN = 'background:#3a2f55;color:#e8e0f5;border:1px solid rgba(180,160,220,0.3);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;flex:1;text-align:center;';

const FAB_W = 40, FAB_H = 40, PAD = 5;

function clampFabPos(left, top) {
    return {
        left: Math.max(PAD, Math.min(window.innerWidth - FAB_W - PAD, left)),
        top: Math.max(PAD, Math.min(window.innerHeight - FAB_H - PAD, top)),
    };
}

function defaultFabPos() {
    // right edge, ~55% down — clear of Spark/Lexicon stack lower-right
    return clampFabPos(window.innerWidth - FAB_W - 15, Math.round(window.innerHeight * 0.55));
}

function applyFabPos($fab, pos) {
    $fab.css({ left: pos.left + 'px', top: pos.top + 'px', right: 'auto', bottom: 'auto' });
}

function mountFab($fab) {
    // v1.0.4: themes put transform/filter on <body> (making it the fixed
    // containing block) and ST's body has zero height — so bottom/right
    // anchoring resolves off-screen (the famous "in DOM at 356,-330").
    // top/left measure from body's ORIGIN, which is the viewport corner
    // regardless of body height. So: top/left only, everywhere.
    $(document.body).append($fab);
    let pos = settings().fabPos;
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') {
        pos = defaultFabPos(); // also migrates old {right,bottom} format
    } else {
        pos = clampFabPos(pos.left, pos.top);
    }
    applyFabPos($fab, pos);
}

// FAB drag state lives at module scope so a single, page-lifetime set of
// window listeners can drive it — no matter how many times the FAB remounts.
const fabDrag = { active: false, moved: false, startX: 0, startY: 0, startLeft: 0, startTop: 0, touchedAt: 0 };
let fabWindowListenersBound = false;
const FAB_DRAG_THRESHOLD = 6;

function fabEl() { return document.getElementById('fortuna-fab'); }

function fabBegin(x, y) {
    const el = fabEl(); if (!el) return;
    fabDrag.active = true; fabDrag.moved = false;
    fabDrag.startX = x; fabDrag.startY = y;
    const r = el.getBoundingClientRect();
    fabDrag.startLeft = r.left;
    fabDrag.startTop = r.top;
}
function fabMove(x, y) {
    if (!fabDrag.active) return;
    const el = fabEl(); if (!el) return;
    const dx = x - fabDrag.startX, dy = y - fabDrag.startY;
    if (Math.abs(dx) + Math.abs(dy) > FAB_DRAG_THRESHOLD) fabDrag.moved = true;
    const pos = clampFabPos(fabDrag.startLeft + dx, fabDrag.startTop + dy);
    el.style.left = pos.left + 'px';
    el.style.top = pos.top + 'px';
}
function fabEnd() {
    if (!fabDrag.active) return;
    fabDrag.active = false;
    const el = fabEl(); if (!el) return;
    if (fabDrag.moved) {
        const r = el.getBoundingClientRect();
        settings().fabPos = { left: r.left, top: r.top };
        saveSettings();
    } else {
        togglePanel(); // clean tap → toggle, exactly once
    }
}

// Bound a single time for the life of the page; safe to call on every remount.
function bindFabWindowListeners() {
    if (fabWindowListenersBound) return;
    fabWindowListenersBound = true;
    window.addEventListener('mousemove', e => { if (fabDrag.active) fabMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (fabDrag.active) fabEnd(); });
    // orientation / keyboard changes: pull the FAB back on-screen
    window.addEventListener('resize', () => {
        const el = fabEl(); if (!el) return;
        const r = el.getBoundingClientRect();
        const pos = clampFabPos(r.left, r.top);
        el.style.left = pos.left + 'px';
        el.style.top = pos.top + 'px';
    });
}

function makeFabDraggable($fab) {
    const el = $fab[0];

    // These listeners are attached to the FAB element itself, so they are
    // garbage-collected with it when initUI() removes-and-recreates the FAB.
    el.addEventListener('touchstart', e => {
        fabDrag.touchedAt = Date.now();
        const t = e.touches[0]; fabBegin(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
        if (!fabDrag.active) return;
        e.preventDefault();
        const t = e.touches[0]; fabMove(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener('touchend', e => {
        fabDrag.touchedAt = Date.now();
        e.preventDefault(); // suppress the synthetic mousedown/up that caused the double-toggle
        fabEnd();
    }, { passive: false });
    el.addEventListener('touchcancel', () => { fabDrag.active = false; fabDrag.moved = false; });
    el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (Date.now() - fabDrag.touchedAt < 700) return; // touch-spawned synthetic event
        fabBegin(e.clientX, e.clientY);
    });

    // Window-level drag/resize handlers — registered once, not per remount.
    bindFabWindowListeners();
}

function panelHtml() {
    const s = settings();
    const snooze = chatState().snooze;
    return `
    <div id="fortuna-panel" style="${PANEL_STYLE}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <b style="font-size:14px;">🎲 Fortuna</b>
            <span id="fortuna-close" style="cursor:pointer;opacity:0.7;padding:2px 6px;">✕</span>
        </div>
        <div style="${ROW}">
            <span>Enabled</span>
            <input type="checkbox" id="fortuna-enabled" ${s.enabled ? 'checked' : ''}>
        </div>
        <div style="${ROW}">
            <span>Difficulty</span>
            <select id="fortuna-difficulty" style="${SELECT}">
                <option value="casual" ${s.difficulty === 'casual' ? 'selected' : ''}>Casual (+2)</option>
                <option value="normal" ${s.difficulty === 'normal' ? 'selected' : ''}>Normal (+0)</option>
                <option value="hard" ${s.difficulty === 'hard' ? 'selected' : ''}>Hard (−2)</option>
            </select>
        </div>
        <div style="${ROW}">
            <span>Atropos</span>
            <select id="fortuna-cadence" style="${SELECT}">
                <option value="every" ${s.atroposCadence === 'every' ? 'selected' : ''}>Every turn (weighted)</option>
                <option value="rare" ${s.atroposCadence === 'rare' ? 'selected' : ''}>Rare (18–20 only)</option>
                <option value="off" ${s.atroposCadence === 'off' ? 'selected' : ''}>Off</option>
            </select>
        </div>
        <div style="${ROW}">
            <span>Scene snooze <span style="opacity:0.55">(this chat)</span></span>
            <input type="checkbox" id="fortuna-snooze" ${snooze ? 'checked' : ''}>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <div id="fortuna-preroll" style="${BTN}">Pre-roll next</div>
        </div>
        <div id="fortuna-pinned" style="margin-top:8px;font-size:11px;opacity:0.8;min-height:14px;"></div>
    </div>`;
}

function positionPanel() {
    const $p = $('#fortuna-panel');
    const fab = document.getElementById('fortuna-fab');
    if (!$p.length) return;
    const pw = Math.min(280, window.innerWidth - 20);
    const ph = $p.outerHeight() || 320;
    let left = window.innerWidth - pw - 10;
    let top = Math.round(window.innerHeight * 0.18);
    if (fab) {
        const r = fab.getBoundingClientRect();
        top = r.top - ph - 10;                 // prefer above the FAB
        if (top < 10) top = r.bottom + 10;     // else below
        if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
        left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.right - pw));
    }
    $p.css({ left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
}

// Holds the bound outside-dismiss handler so we can remove it on close.
let fortunaOutsideHandler = null;

function bindOutsideDismiss() {
    if (fortunaOutsideHandler) return;
    fortunaOutsideHandler = (e) => {
        const panel = document.getElementById('fortuna-panel');
        const fab = document.getElementById('fortuna-fab');
        if (!panel) return;
        if (panel.contains(e.target)) return;          // tap inside the panel
        if (fab && fab.contains(e.target)) return;      // tap on the FAB (it toggles itself)
        closePanel();
    };
    // Defer one tick so the tap that opened the panel can't immediately close it.
    setTimeout(() => {
        if (!fortunaOutsideHandler) return;
        document.addEventListener('touchstart', fortunaOutsideHandler, { passive: true });
        document.addEventListener('mousedown', fortunaOutsideHandler, true);
    }, 0);
}

function unbindOutsideDismiss() {
    if (!fortunaOutsideHandler) return;
    document.removeEventListener('touchstart', fortunaOutsideHandler, { passive: true });
    document.removeEventListener('mousedown', fortunaOutsideHandler, true);
    fortunaOutsideHandler = null;
}

function openPanel() {
    refreshPanel();
    $('#fortuna-panel').show();
    positionPanel();
    bindOutsideDismiss();
}

function closePanel() {
    $('#fortuna-panel').hide();
    unbindOutsideDismiss();
}

function togglePanel() {
    if ($('#fortuna-panel').is(':visible')) closePanel();
    else openPanel();
}

function refreshPanel() {
    const s = settings();
    $('#fortuna-enabled').prop('checked', s.enabled);
    $('#fortuna-difficulty').val(s.difficulty);
    $('#fortuna-cadence').val(s.atroposCadence);
    $('#fortuna-snooze').prop('checked', chatState().snooze);
    updatePanelPinned();
}

function updatePanelPinned() {
    const $el = $('#fortuna-pinned');
    if (!$el.length) return;
    if (pinnedRoll) {
        $el.html(`Pinned for next turn: <b>C${pinnedRoll.clotho} · L${pinnedRoll.lachesis} · A${pinnedRoll.atropos}</b> · pool [${pinnedRoll.pool.join(', ')}]`);
    } else {
        $el.text('');
    }
}

function initUI() {
    unbindOutsideDismiss(); // fresh panel starts hidden; drop any stale listener
    $('#fortuna-fab, #fortuna-panel').remove();
    const $fab = $(`<div id="fortuna-fab" style="${FAB_STYLE}" title="Fortuna">🎲</div>`);
    mountFab($fab);
    makeFabDraggable($fab);
    $('body').append(panelHtml());

    $('#fortuna-close').on('click', () => closePanel());
    $('#fortuna-enabled').on('change', function () {
        settings().enabled = $(this).prop('checked');
        saveSettings();
        if (!settings().enabled) clearInjection();
        toastr.info(settings().enabled ? 'Fortuna watches.' : 'Fortuna looks away.');
    });
    $('#fortuna-difficulty').on('change', function () {
        settings().difficulty = $(this).val();
        saveSettings();
    });
    $('#fortuna-cadence').on('change', function () {
        settings().atroposCadence = $(this).val();
        saveSettings();
    });
    $('#fortuna-snooze').on('change', function () {
        chatState().snooze = $(this).prop('checked');
        saveChatState();
        if (chatState().snooze) clearInjection();
        toastr.info(chatState().snooze ? 'The Fates avert their eyes (this chat).' : 'The Fates resume their watch.');
    });
    $('#fortuna-preroll').on('click', function () {
        pinnedRoll = rollFates(settings());
        pinnedRoll.pinned = true;
        updatePanelPinned();
    });
}

function destroyUI() {
    unbindOutsideDismiss();
    $('#fortuna-fab, #fortuna-panel').remove();
}

let keepaliveTimer = null;
function startKeepalive() {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
        try {
            if (!document.getElementById('fortuna-fab') || !document.getElementById('fortuna-panel')) {
                console.warn(TAG, 'UI evicted — resurrecting');
                initUI();
            }
        } catch (e) { /* non-critical */ }
    }, 4000);
}

// ─────────────────────────────────────────────────────────────────
// Slash commands (layered: modern parser → legacy fallback)
// ─────────────────────────────────────────────────────────────────

function parseFormula(str) {
    const m = String(str || '').trim().match(/^(\d*)d(\d+)$/i);
    if (!m) return { count: 1, sides: 20 };
    return { count: Math.min(Math.max(parseInt(m[1] || '1', 10), 1), 20), sides: Math.min(Math.max(parseInt(m[2], 10), 2), 1000) };
}

function cmdRoll(_namedArgs, formula) {
    const { count, sides } = parseFormula(formula);
    const rolls = Array.from({ length: count }, () => rollDie(sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    const text = count === 1 ? `${count}d${sides}: ${total}` : `${count}d${sides}: [${rolls.join(', ')}] = ${total}`;
    toastr.info(text, '🎲 Fortuna');
    return String(total);
}

function cmdSnooze() {
    chatState().snooze = !chatState().snooze;
    saveChatState();
    if (chatState().snooze) clearInjection();
    refreshPanel();
    toastr.info(chatState().snooze ? 'Snoozed (this chat).' : 'Awake.', '🎲 Fortuna');
    return String(chatState().snooze);
}

function cmdPanel() {
    if (!document.getElementById('fortuna-fab')) initUI();
    togglePanel();
    return '';
}

function cmdDebug() {
    const s = settings();
    const lines = [
        `enabled: ${s.enabled}`,
        `difficulty: ${s.difficulty} (mod ${DIFFICULTY_MOD[s.difficulty]})`,
        `atropos: ${s.atroposCadence}`,
        `depth: ${s.injectionDepth} | pool: ${s.poolSize}`,
        `snooze (chat): ${chatState().snooze}`,
        `pinned: ${pinnedRoll ? `C${pinnedRoll.clotho}/L${pinnedRoll.lachesis}/A${pinnedRoll.atropos}` : 'none'}`,
        `pending: ${pendingRoll ? 'yes' : 'no'}`,
        (() => {
            const el = document.getElementById('fortuna-fab');
            if (!el) return 'fab: ❌ MISSING from DOM';
            const r = el.getBoundingClientRect();
            const vis = r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
            return `fab: in DOM at ${Math.round(r.left)},${Math.round(r.top)} ${vis ? '(on-screen)' : '⚠️ OFF-SCREEN'} parent=${el.parentElement?.tagName}`;
        })(),
    ].join('<br>');
    toastr.info(lines, '🎲 Fortuna state', { timeOut: 9000, escapeHtml: false });
    return '';
}

async function registerCommands() {
    // Layer 1: direct module imports (canonical, modern ST) — dynamic so a
    // missing module degrades gracefully instead of killing the extension.
    try {
        const { SlashCommandParser } = await import('../../../slash-commands/SlashCommandParser.js');
        const { SlashCommand } = await import('../../../slash-commands/SlashCommand.js');
        const { SlashCommandArgument, ARGUMENT_TYPE } = await import('../../../slash-commands/SlashCommandArgument.js');
        const P = SlashCommandParser, C = SlashCommand, A = SlashCommandArgument, T = ARGUMENT_TYPE;
        if (P?.addCommandObject && C?.fromProps) {
            P.addCommandObject(C.fromProps({
                name: 'fortuna-roll',
                callback: cmdRoll,
                unnamedArgumentList: A ? [A.fromProps({ description: 'dice formula, e.g. 1d20 or 3d6', typeList: T ? [T.STRING] : undefined, isRequired: false })] : [],
                helpString: 'Roll honest dice (default 1d20). Returns the total.',
            }));
            P.addCommandObject(C.fromProps({
                name: 'fortuna',
                callback: cmdPanel,
                helpString: 'Open the Fortuna panel (remounts the FAB if missing).',
            }));
            P.addCommandObject(C.fromProps({
                name: 'fortuna-snooze',
                callback: cmdSnooze,
                helpString: 'Toggle Fortuna scene snooze for this chat.',
            }));
            P.addCommandObject(C.fromProps({
                name: 'fortuna-debug',
                callback: cmdDebug,
                helpString: 'Show Fortuna state as a toast.',
            }));
            console.log(TAG, 'slash commands registered (modern parser)');
            return;
        }
    } catch (e) {
        console.warn(TAG, 'modern slash-command modules unavailable, trying legacy', e);
    }
    // Layer 2: legacy registerSlashCommand — try context, script.js export, and window
    try {
        const c = ctx();
        let legacy = c?.registerSlashCommand || window.registerSlashCommand;
        if (!legacy) {
            try {
                const script = await import('../../../../script.js');
                legacy = script.registerSlashCommand;
            } catch (_) { /* */ }
        }
        if (typeof legacy === 'function') {
            legacy('fortuna-roll', (_a, v) => cmdRoll(_a, v), [], '– roll honest dice (default 1d20)', true, true);
            legacy('fortuna', () => cmdPanel(), [], '– open the Fortuna panel', true, true);
            legacy('fortuna-snooze', () => cmdSnooze(), [], '– toggle scene snooze', true, true);
            legacy('fortuna-debug', () => cmdDebug(), [], '– show Fortuna state', true, true);
            console.log(TAG, 'slash commands registered (legacy)');
            return;
        }
        throw new Error('no registration API found');
    } catch (e) {
        console.error(TAG, 'slash command registration failed entirely', e);
        try { toastr.warning('Slash commands unavailable on this ST version — FAB panel still works.', '🎲 Fortuna'); } catch (_) { /* */ }
    }
}

// ─────────────────────────────────────────────────────────────────
// Events + init
// ─────────────────────────────────────────────────────────────────

function on(eventName, fn, label) {
    if (!eventName) {
        console.warn(TAG, 'missing event type:', label);
        return;
    }
    ES().on(eventName, fn);
}

function registerEvents() {
    const t = ET();
    on(t.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands, 'GENERATION_AFTER_COMMANDS');
    on(t.MESSAGE_RECEIVED, onMessageReceived, 'MESSAGE_RECEIVED');
    on(t.MESSAGE_SWIPED, onMessageSwiped, 'MESSAGE_SWIPED');
    on(t.CHARACTER_MESSAGE_RENDERED, (mesId) => renderChipFor(Number(mesId)), 'CHARACTER_MESSAGE_RENDERED');
    on(t.CHAT_CHANGED, () => {
        pendingRoll = null;
        pinnedRoll = null;
        clearInjection();
        setTimeout(renderAllChips, 300);
        refreshPanel();
    }, 'CHAT_CHANGED');
    on(t.GENERATION_STOPPED, () => { pendingRoll = null; }, 'GENERATION_STOPPED');
}

// CODEX / CHRONICLER BRIDGE — SHIPPED (v2.0.0, read-only): buildInjection()
// reads CodexAPI.getActiveState/getEmotionalState and ChroniclerAPI.getActiveRung
// and folds them into the MODIFIER section. Defensive: absent siblings degrade to
// the difficulty dial alone. Fortuna never calls a triad write-verb.
// PHASE B (not here): FortunaAPI.getFlowPressure() for Chronicler's walker to READ;
// JS-tracked FRAGILE integers via a receipt parser. Deferred until the contract binds.

jQuery(async () => {
    try {
        console.log(TAG, 'spinning the thread…');
        settings(); // hydrate defaults
        initUI();
        startKeepalive();
        registerEvents();
        await registerCommands();
        setTimeout(renderAllChips, 1000);
        console.log(TAG, '✅ the Fates are watching');
        try { toastr.success('v2.0.1 loaded — the Fates are watching, and they keep score.', '🎲 Fortuna', { timeOut: 3000 }); } catch (_) { /* */ }
    } catch (e) {
        console.error(TAG, '❌ critical failure', e);
        try { toastr.error('Fortuna failed to initialize.', 'Fortuna', { timeOut: 10000 }); } catch (_) { /* */ }
    }
});
