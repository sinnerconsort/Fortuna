/**
 * ═══════════════════════════════════════════════════════════════════
 *  FORTUNA v1.0.2 — The Fates roll, the prose obeys.
 * ═══════════════════════════════════════════════════════════════════
 *  Honest dice for SillyTavern. JS rolls (real rejection sampling,
 *  because we keep our promises), the model only narrates.
 *
 *  The three Fates:
 *    • Clotho   — action die (d20). Resolves attempted actions.
 *    • Lachesis — intensity die (d20). How boldly NPCs act.
 *    • Atropos  — event die (d20). Outside complications, resolved
 *                 table-side in JS; only the OUTCOME is injected.
 *  Plus a surplus pool of 5 unlabeled d20s for additional checks —
 *  consumed strictly in order, never reused, never invented.
 *
 *  Design rules:
 *    • FAILURE FORKS, NEVER WALLS (Disco Elysium rule, always on).
 *    • Every roll leaves a receipt (chip under the message).
 *    • Stateless v1.0 — no per-chat memory beyond snooze + receipts.
 *
 *  v1.1 stub: ERIS EVENTS — world-specific chaos variables generated
 *  via utility call against lore fractures, stored extension-local,
 *  fired by Atropos ranges. (see buildAtropos comment below)
 *  Future stub: CODEX BRIDGE — wound/stress state → DC modifiers.
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

function buildInjection(roll) {
    const mod = DIFFICULTY_MOD[roll.difficulty] ?? 0;
    const modLine = mod === 0
        ? 'No global modifier.'
        : `Global modifier: ${mod > 0 ? '+' + mod : mod} (apply to dice before comparing to DC; natural 1s and 20s are judged on the raw die).`;

    const eventText = resolveAtropos(roll.atropos, roll.cadence);
    const atroposLine = eventText
        ? `• Atropos (event die): this turn, ${eventText}. Weave it in naturally; skip it silently if it would break the scene's tone or intimacy.`
        : '• Atropos (event die): the thread holds — no outside event this turn.';

    return [
        '<fortuna>',
        'THE FATES HAVE ALREADY ROLLED. These dice are pre-rolled and immutable — never invent, alter, or re-roll dice yourself.',
        `• Clotho (action die): ${roll.clotho}/20 — resolves the primary attempted action this turn (any character's).`,
        `• Lachesis (intensity die): ${roll.lachesis}/20 — NPC initiative this turn: ${lachesisBand(roll.lachesis)}.`,
        atroposLine,
        `• Surplus pool for ADDITIONAL checks beyond the first: [${roll.pool.join(', ')}]. Consume strictly left to right, one die per extra check, never reuse a die. If the pool runs out, remaining minor actions resolve as routine — do not invent new dice.`,
        '',
        'ACTION RESOLUTION (apply silently whenever an action has a meaningful chance of failure; ordinary dialogue needs no roll):',
        '1. Set a DC from context: 1-5 trivial, 6-10 easy, 11-15 moderate, 16-20 hard, 21+ near-impossible.',
        `2. ${modLine}`,
        '3. Die ≥ DC → success. Margin 0: marginal (works, with friction). 1-4: solid. 5-9: great. Natural 20: critical — exceptional, beyond expectation.',
        '4. Die < DC → failure. Margin 1-3: near miss. 4-7: clear setback. 8-14: costly. 15+ or natural 1: disaster.',
        '',
        'FAILURE FORKS, NEVER WALLS: every failure must open a different path — a new complication, revelation, pressure, or opportunity — never a dead stop. Worse failures buy more expensive paths, not less story.',
        'Never announce dice, DCs, margins, or mechanics in the narrative. The fiction stays seamless.',
        '</fortuna>',
    ].join('\n');
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
    return `
        <div class="fortuna-chip" style="${CHIP_BASE}" title="Fortuna — tap for the full cast">
            <span>🎲</span>
            <span>C${roll.clotho} · L${roll.lachesis} · ${aShort}</span>
            <span style="opacity:0.6">▾</span>
        </div>
        <div class="fortuna-detail" style="${DETAIL_BASE}">
            <div><b>Clotho</b> (action): ${roll.clotho}/20</div>
            <div><b>Lachesis</b> (intensity): ${roll.lachesis}/20 — ${lachesisBand(roll.lachesis)}</div>
            <div><b>Atropos</b> (event): ${roll.atropos}/20 — ${eventText ? eventText : 'the thread holds'}</div>
            <div><b>Pool</b>: [${roll.pool.join(', ')}]</div>
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

const FAB_STYLE = `position:fixed;right:15px;bottom:180px;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#5a4a7a,#2e2542);color:#e8e0f5;border:1px solid rgba(180,160,220,0.4);box-shadow:0 2px 8px rgba(0,0,0,0.45);z-index:${Z};display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;touch-action:none;`;
const PANEL_STYLE = `position:fixed;right:10px;bottom:230px;width:min(280px, calc(100vw - 20px));background:rgba(24,19,36,0.97);border:1px solid rgba(180,160,220,0.35);border-radius:12px;padding:12px;z-index:${Z};color:#e8e0f5;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.55);display:none;`;
const ROW = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;';
const SELECT = 'background:#1c1530;color:#e8e0f5;border:1px solid rgba(180,160,220,0.3);border-radius:6px;padding:3px 6px;font-size:12px;max-width:140px;';
const BTN = 'background:#3a2f55;color:#e8e0f5;border:1px solid rgba(180,160,220,0.3);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;flex:1;text-align:center;';

function mountFab($fab) {
    const host = $('#form_sheld').length ? $('#form_sheld') : $('body');
    host.append($fab);
    // trap probe: transformed/filtered ancestors hijack position:fixed
    $fab.css({ left: '0px', top: '0px', right: 'auto', bottom: 'auto' });
    const r = $fab[0].getBoundingClientRect();
    if (Math.abs(r.left) > 1 || Math.abs(r.top) > 1) {
        $(document.body).append($fab); // append = move; listeners survive
        console.warn(TAG, 'host is a transformed containing block — FAB mounted on <body>');
    }
    $fab.css({ left: '', top: '', right: '15px', bottom: '180px' });
    // restore saved position, clamped to live viewport
    const saved = settings().fabPos;
    if (saved) {
        const pad = 5, w = 40, h = 40;
        const right = Math.max(pad, Math.min(window.innerWidth - w - pad, saved.right));
        const bottom = Math.max(pad, Math.min(window.innerHeight - h - pad, saved.bottom));
        $fab.css({ right: right + 'px', bottom: bottom + 'px' });
    }
}

function makeFabDraggable($fab) {
    let dragging = false, moved = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;
    const el = $fab[0];

    function start(x, y) {
        dragging = true; moved = false;
        startX = x; startY = y;
        const r = el.getBoundingClientRect();
        startRight = window.innerWidth - r.right;
        startBottom = window.innerHeight - r.bottom;
    }
    function move(x, y) {
        if (!dragging) return;
        const dx = x - startX, dy = y - startY;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        const pad = 5, w = 40, h = 40;
        const right = Math.max(pad, Math.min(window.innerWidth - w - pad, startRight - dx));
        const bottom = Math.max(pad, Math.min(window.innerHeight - h - pad, startBottom - dy));
        el.style.right = right + 'px';
        el.style.bottom = bottom + 'px';
    }
    function end() {
        if (!dragging) return;
        dragging = false;
        if (moved) {
            const r = el.getBoundingClientRect();
            settings().fabPos = {
                right: window.innerWidth - r.right,
                bottom: window.innerHeight - r.bottom,
            };
            saveSettings();
        }
    }

    el.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    el.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); const t = e.touches[0]; move(t.clientX, t.clientY); } }, { passive: false });
    el.addEventListener('touchend', () => { const wasMoved = moved; end(); if (!wasMoved) togglePanel(); });
    el.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { const wasMoved = moved; const wasDragging = dragging; end(); if (wasDragging && !wasMoved) togglePanel(); });
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

function togglePanel() {
    const $p = $('#fortuna-panel');
    if ($p.is(':visible')) $p.hide();
    else { refreshPanel(); $p.show(); }
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
    $('#fortuna-fab, #fortuna-panel').remove();
    const $fab = $(`<div id="fortuna-fab" style="${FAB_STYLE}" title="Fortuna">🎲</div>`);
    mountFab($fab);
    makeFabDraggable($fab);
    $('body').append(panelHtml());

    $('#fortuna-close').on('click', () => $('#fortuna-panel').hide());
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
    $('#fortuna-fab, #fortuna-panel').remove();
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

// FUTURE — CODEX BRIDGE (do not build until Codex visibility pass ships):
// if (window.CodexAPI?.getActiveStates) { wounded → DC +2..5; 'breaks-like'
// active under stress → tighten failure margins. Inject as one extra line. }

jQuery(async () => {
    try {
        console.log(TAG, 'spinning the thread…');
        settings(); // hydrate defaults
        initUI();
        registerEvents();
        await registerCommands();
        setTimeout(renderAllChips, 1000);
        console.log(TAG, '✅ the Fates are watching');
        try { toastr.success('v1.0.2 loaded — the Fates are watching.', '🎲 Fortuna', { timeOut: 3000 }); } catch (_) { /* */ }
    } catch (e) {
        console.error(TAG, '❌ critical failure', e);
        try { toastr.error('Fortuna failed to initialize.', 'Fortuna', { timeOut: 10000 }); } catch (_) { /* */ }
    }
});
