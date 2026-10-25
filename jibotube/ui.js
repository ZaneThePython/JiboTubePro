'use strict';

// JiboTube touch UI (1.1.0 design). Native View/Button/Label components only;
// every shape is painted with drawRect spans (draw.js). Text is measured with
// PIXI.TextMetrics and ellipsized here, never auto-shrunk by the SDK.
// Layout rules (tested): every enabled target is at least 64 px (primary 88),
// inside the round-screen safe area (120 px corner radius), no two enabled
// targets overlap, no label below 20 px, Back is always the same button in the
// same place, and work-starting buttons show that they are busy and refuse a
// second start until the first one finishes.
const draw = require('./draw');
const ArtCache = require('./art').ArtCache;

const FONT = 'Proxima Nova Soft';
const COLOR = {
    bg0: 0x07151B, bg1: 0x0A1E26, rail: 0x061317, surface: 0x0F252D, raised: 0x17363F, raisedHi: 0x22505B, card: 0x0E2730,
    line: 0x234650, line2: 0x2E5A65, text: 0xFFFFFF, text2: 0xC4DCE2, text3: 0xA2BEC7,
    accent: 0x2FD0C0, accentDark: 0x0E6E67, accentHi: 0x6FF0E2, coral: 0xFF6B5A, onAccent: 0x03211E, danger: 0xFF9A8B,
    dangerFill: 0xE5604A, sponsor: 0xFFC266, disabled: 0x7D9AA2
};
// Type scale (px): display 40, title 32, heading 28, body 24, meta 22, small 20.
const TYPE = { display: 40, title: 32, heading: 28, body: 24, meta: 22, small: 20 };
const LEFT = 248, RIGHT = 1232, W = RIGHT - LEFT, MID = 740, TOP_RIGHT = 1216;
const CARD_W = 234, CARD_GAP = 16, CARD_PITCH = CARD_W + CARD_GAP, THUMB_H = 132, CARD_H = 220;
const SHELF_TOP = [88, 388];
const ROW_TOP = 108, ROW_H = 128, RESULT_PITCH = 140;
const BACK = { x: LEFT, y: 16, w: 156, h: 72 };
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', '-/:;()&@"', '.,?!\'#+'];
const KEYS = { y: [184, 264, 344], h: 72, w: 88, gap: 8, start: [264, 312, 408] };
const SPECIAL_Y = 424, SPECIAL_H = 88;
// A button that just appeared under a finger, or any tap right after an
// action, is ignored for this long: the second tap of a double tap never
// lands on the next screen. Typing, Close, volume and paging are exempt.
const TAP_SETTLE_MS = 350;
const NO_RESULTS = { title: 'Nothing found', body: 'Try different words.' };

// User-visible status vocabulary: exactly the JTROBUST STATUS-CONTRACT v1
// codes. Plain words. `kind` decides the one next step: retry (Try again,
// only when the failure is retryable), video (this video cannot play here:
// pick another), close (only reopening helps), busy (working; no button).
const STATUS = {
    // Active states.
    starting_service: { kind: 'busy', title: 'Starting JiboTube…', body: 'This takes a few seconds.' },
    loading: { kind: 'busy', title: 'Loading…', body: 'Finding something to watch.' },
    buffering: { kind: 'busy', title: 'Getting the video ready…', body: '' },
    starting_player: { kind: 'busy', title: 'Starting video…', body: '' },
    reconnecting: { kind: 'busy', title: 'Reconnecting…', body: 'The video lost its connection. Trying once more.' },
    format_fallback: { kind: 'busy', title: 'Trying a lower quality…', body: '' },
    paused: { kind: 'state', title: 'Paused', body: '' },
    ended: { kind: 'state', title: 'Video finished', body: '' },
    playing: { kind: 'state', title: '', body: '' },
    ready: { kind: 'state', title: '', body: '' },
    // Terminal errors.
    timeout: { kind: 'retry', retryable: true, title: 'Videos took too long to load', body: 'The internet may be slow right now. Try again.',
        results: { title: 'Search took too long', body: 'The internet may be slow right now. Try again.' },
        details: { title: 'This video took too long to load', body: 'The internet may be slow right now. Try again.' } },
    network_unavailable: { kind: 'retry', retryable: true, title: "Couldn't connect", body: "Check Jibo's internet connection, then try again." },
    provider_busy: { kind: 'retry', retryable: true, title: 'Videos are busy right now', body: 'Wait a moment, then try again.' },
    provider_unavailable: { kind: 'retry', retryable: true, title: "Videos aren't available right now", body: 'Try again a little later.' },
    provider_changed: { kind: 'video', retryable: false, title: "Videos couldn't load", body: 'Something changed on the video site. Try again later, or pick another video.' },
    age_restricted: { kind: 'video', retryable: false, title: "This video can't play here", body: 'It needs a signed-in account. Pick another video.' },
    region: { kind: 'video', retryable: false, title: "This video can't play here", body: "It isn't available where you live. Pick another video." },
    members_only: { kind: 'video', retryable: false, title: "This video can't play here", body: "It's only for the channel's members. Pick another video." },
    unavailable: { kind: 'video', retryable: false, title: "This video isn't available", body: 'It may have been removed or made private.' },
    unsupported_live: { kind: 'video', retryable: false, title: "Live videos can't play here", body: 'Come back after the live show has ended.' },
    video_too_long: { kind: 'video', retryable: false, title: 'This video is too long', body: 'Jibo can play videos up to 6 hours long.' },
    unsupported_format: { kind: 'video', retryable: false, title: "Jibo can't play this video", body: "Its video format doesn't work on Jibo." },
    audio_missing: { kind: 'video', retryable: false, title: "Jibo can't play this video", body: "Its sound format doesn't work on Jibo." },
    host_unavailable: { kind: 'retry', retryable: true, title: "The video didn't start", body: "Jibo's video player couldn't open. Try again." },
    start_failed: { kind: 'retry', retryable: true, title: "The video didn't start", body: "Jibo's video player couldn't open. Try again." },
    window_timeout: { kind: 'retry', retryable: true, title: "The video didn't start", body: "The picture didn't appear. Try again." },
    playback_stalled: { kind: 'retry', retryable: true, title: 'The video stopped', body: 'It lost its connection. Try again.' },
    playback_failed: { kind: 'retry', retryable: true, title: 'The video stopped', body: 'Try again, or pick another video.' },
    session_limit: { kind: 'close', retryable: false, title: 'Time for a break', body: 'JiboTube stopped after a long time playing. Close it and open it again to keep watching.' },
    storage_unavailable: { kind: 'warning', retryable: true, title: "Couldn't save that change", body: 'You can keep watching. History and likes may not be kept.' },
    service_unavailable: { kind: 'retry', retryable: true, title: "JiboTube couldn't load videos", body: 'Try again in a moment.',
        results: { title: "Search didn't work", body: 'Try again in a moment.' }, details: { title: "This video didn't load", body: 'Try again in a moment.' } },
    // Contract: retryable, but the step that helps is closing and reopening.
    unauthorized: { kind: 'close', retryable: true, title: "JiboTube couldn't connect", body: 'Close JiboTube, then open it again.' },
    teardown_unconfirmed: { kind: 'close', retryable: false, title: "JiboTube couldn't finish closing", body: 'Close JiboTube, then open it again.' },
    // Optional parts that are missing: never a screen of their own.
    sponsor_unavailable: { kind: 'degraded', title: '', body: '' },
    captions_unavailable: { kind: 'degraded', title: '', body: 'This video has no captions.' },
    thumbnail_unavailable: { kind: 'degraded', title: '', body: '' }
};
// Legacy and wire aliases (STATUS-CONTRACT "Legacy aliases"), plus Node
// socket errors from the loopback client.
const ALIASES = {
    stream_unavailable: 'unsupported_format', video_unavailable: 'unavailable', play_error: 'playback_failed', player: 'playback_failed',
    player_exit: 'playback_failed', host_exit: 'playback_failed', bad_response: 'provider_changed', response_too_large: 'provider_changed',
    bad_json: 'provider_changed', range_timeout: 'timeout', format_changed: 'playback_failed', thumb_unavailable: 'thumbnail_unavailable',
    jibotube_helper_stop_unconfirmed: 'teardown_unconfirmed', jibotube_video_stop_unconfirmed: 'teardown_unconfirmed',
    ECONNREFUSED: 'service_unavailable', ECONNRESET: 'service_unavailable', EPIPE: 'service_unavailable', ECONNABORTED: 'service_unavailable',
    ETIMEDOUT: 'timeout', ESOCKETTIMEDOUT: 'timeout', ENOTFOUND: 'network_unavailable', EAI_AGAIN: 'network_unavailable',
    ENETUNREACH: 'network_unavailable', EHOSTUNREACH: 'network_unavailable'
};
// Internal validation failures are never user copy; they get the
// operation's generic error.
const FALLBACK = { screen: 'service_unavailable', results: 'service_unavailable', details: 'provider_unavailable', player: 'playback_failed' };
// Any error, code or reason -> a contract code (never raw messages).
function statusCode(value, context) {
    let code = value;
    if (value && typeof value === 'object') code = value.code || value.reason || '';
    code = typeof code === 'string' ? code : '';
    if (/^range_/.test(code) && code !== 'range_timeout') code = 'playback_failed';
    if (/stop_unconfirmed$|^jibotube_view_/.test(code)) code = 'teardown_unconfirmed';
    if (ALIASES[code]) code = ALIASES[code];
    return STATUS[code] ? code : (FALLBACK[context] || 'service_unavailable');
}
// The words and the one next step for a status in a context ('screen' =
// full-screen error, 'details', 'results', 'player'). `retryable` from the
// controller (state.status.retryable) wins over the table: Try again is
// offered only when it is true. Back and Close stay available regardless.
function statusInfo(value, options) {
    options = options || {};
    const context = options.context || 'screen';
    const code = statusCode(value, context), entry = STATUS[code];
    const given = value && typeof value === 'object' && typeof value.retryable === 'boolean' ? value.retryable : undefined;
    const retryable = given !== undefined ? given : entry.retryable === true;
    let action = '';
    if (entry.kind === 'busy' || entry.kind === 'state' || entry.kind === 'degraded') action = '';
    else if (entry.kind === 'close') action = 'close';
    else if (retryable && entry.kind !== 'warning') action = 'retry';
    else if (context === 'details' || context === 'player') action = 'back';
    else if (context === 'results') action = 'back';
    else action = options.canBack ? 'back' : 'close';
    const labels = { retry: 'Try again', close: 'Close JiboTube', back: context === 'details' || context === 'player' ? 'Pick another video' : context === 'results' ? 'Search again' : 'Back' };
    const words = entry[context] || entry;
    return { code: code, kind: entry.kind, title: words.title || '', body: words.body || '', action: action, label: labels[action] || '',
        retry: action === 'retry', retryable: retryable, busy: entry.kind === 'busy' };
}

function hex(value) { return '#' + ('000000' + value.toString(16)).slice(-6); }
function clock(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2);
}
function views(value) {
    value = Number(value) || 0;
    if (value >= 1e9) return (value / 1e9).toFixed(value >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B views';
    if (value >= 1e6) return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M views';
    if (value >= 1e3) return (value / 1e3).toFixed(value >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K views';
    return value + (value === 1 ? ' view' : ' views');
}
function ago(value) {
    if (!value) return '';
    if (/ago$|^Streamed|^Premiered/i.test(value)) return value;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 8) return String(value);
    const date = new Date(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8)));
    if (isNaN(date.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}
// Emoji and pictographs are not in the robot's font; drop them.
function plain(value) { return String(value || '').replace(/[\uD800-\uDFFF\uFE0F\u200D\u2600-\u27BF]/g, '').replace(/\s+/g, ' ').trim(); }
function shorten(value, length) {
    const s = plain(value);
    return s.length > length ? s.slice(0, length - 1).replace(/\s+$/, '') + '…' : s;
}
function wide(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) || (code >= 0xAC00 && code <= 0xD7A3) ||
        (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60);
}
// Offline estimate used only when no PIXI is available (pure-model tests).
function estimate(text, size, bold) {
    return Array.from(String(text)).reduce((sum, ch) => sum + (/\s/.test(ch) ? 0.27 : wide(ch) ? 1 : /[MWmw@%]/.test(ch) ? 0.86 : /[A-Z]/.test(ch) ? 0.66 : 0.56) * size, 0) * (bold ? 1.05 : 1);
}
// Split text into at most `lines` lines that each fit `width` px; the last
// line keeps the rest (the label ellipsizes it). Words wrap at spaces; text
// without spaces (Japanese, Chinese) or a single over-long word breaks by
// character.
function fitLines(value, width, measure, lines) {
    const s = plain(value), out = [];
    if (!s) { while (out.length < lines) out.push(''); return out; }
    let rest = s;
    while (out.length < lines - 1 && rest) {
        if (measure(rest) <= width) { out.push(rest); rest = ''; break; }
        const words = rest.split(' ');
        let line = '', used = 0;
        for (let i = 0; i < words.length; i++) {
            const candidate = line ? line + ' ' + words[i] : words[i];
            if (measure(candidate) <= width) { line = candidate; used = i + 1; continue; }
            break;
        }
        if (!line || measure(words[0]) > width) {
            // Break by character (also inside an over-long first word).
            const chars = Array.from(rest); let n = 0;
            while (n < chars.length && measure(chars.slice(0, n + 1).join('')) <= width) n++;
            n = Math.max(1, n);
            line = chars.slice(0, n).join('').replace(/\s+$/, '');
            rest = chars.slice(n).join('').replace(/^\s+/, '');
        } else rest = words.slice(used).join(' ');
        out.push(line);
    }
    if (rest) out.push(rest);
    while (out.length < lines) out.push('');
    return out;
}
function splitTitle(value, width) {
    // Character-count split kept for callers without a measure (legacy API).
    const s = plain(value);
    if (!s) return ['', ''];
    if (s.length <= width) return [s, ''];
    let cut = s.lastIndexOf(' ', width);
    if (cut < width * 0.55) cut = width;
    const first = s.slice(0, cut).trim(), rest = s.slice(cut).trim();
    return [first, rest.length > width ? rest.slice(0, width - 1).replace(/\s+$/, '') + '…' : rest];
}
function wrap(value, width, lines) {
    const words = plain(value).split(' ').filter(Boolean);
    const out = [];
    let line = '';
    words.forEach(word => {
        if (out.length >= lines) return;
        if ((line + ' ' + word).trim().length > width && line) { out.push(line); line = word; return; }
        line = (line + ' ' + word).trim();
    });
    if (line && out.length < lines) out.push(line);
    while (out.length < lines) out.push('');
    if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = out[lines - 1].replace(/\s+$/, '') + '…';
    return out;
}

class UI {
    constructor(actions) {
        this.actions = actions;
        this.controls = []; this.byId = {}; this.shapes = {}; this.slots = {}; this.cache = {}; this.rects = {};
        this.state = null; this.frame = null; this.view = null; this.views = null; this.PIXI = null; this.art = null; this.timers = null; this.released = false;
        this.groupConfigs = { base: [], home: [], search: [], voice: [], results: [], details: [], library: [], player: [] };
        this.controlGroup = {}; this.screenGroup = 'base'; this.pressed = ''; this.styles = {}; this.shownAt = {}; this.lastActionAt = 0;
    }

    measure(text, size, bold) {
        const PIXI = this.PIXI;
        if (PIXI && PIXI.TextMetrics && PIXI.TextStyle) {
            const key = size + (bold ? 'b' : '');
            let style = this.styles[key];
            if (!style) style = this.styles[key] = new PIXI.TextStyle({ fontSize: size, fontFamily: FONT, fontWeight: bold ? 'bold' : 'normal' });
            try { return PIXI.TextMetrics.measureText(String(text), style).width; } catch (_) {}
        }
        return estimate(text, size, bold);
    }
    lines(text, width, size, bold, count) { return fitLines(text, width, sample => this.measure(sample, size, bold), count); }

    config(views) {
        this.views = views;
        const components = [];
        const label = (id, spec) => {
            const c = Object.assign({ id: id, button: false, align: 'center', size: TYPE.body, color: COLOR.text, bold: false }, spec || {});
            c.height = c.height || Math.ceil(c.size * 1.55);
            this.controls.push(c); this.byId[id] = c;
            const anchor = c.align === 'left' ? 0 : c.align === 'right' ? 1 : 0.5;
            const config = { type: 'Label', id: id, text: c.initial || '', position: { x: c.x, y: c.y },
                targetAnchor: { x: anchor, y: 0.5 }, bounds: { width: c.width, height: c.height },
                style: { fontSize: c.size, fontFamily: FONT, fill: hex(c.color), align: c.align, fontWeight: c.bold ? 'bold' : 'normal' } };
            components.push(config);
            const group = this.groupOfId(id); this.controlGroup[id] = group; this.groupConfigs[group].push(config);
            return c;
        };
        const button = (id, spec) => {
            const c = Object.assign({ id: id, button: true }, spec || {});
            this.controls.push(c); this.byId[id] = c;
            const config = { type: 'Button', id: id, assets: [], position: { x: c.x, y: c.y },
                hitArea: { x: 0, y: 0, width: c.w || 64, height: c.h || 64 },
                action: { type: views.ActionData.CALLBACK, data: { callback: () => this.press(id) } } };
            components.push(config);
            const group = this.groupOfId(id); this.controlGroup[id] = group; this.groupConfigs[group].push(config);
            return c;
        };
        const call = (name, ...args) => () => this.actions[name].apply(null, args);
        const railShown = f => f.screen !== 'voice' && f.screen !== 'player';
        const content = f => !f.status; // a full-screen status replaces the screen's own content

        // Brand and rail.
        label('brandJibo', { show: railShown, x: 28, y: 48, size: TYPE.heading, width: 78, align: 'left', bold: true, initial: 'JIBO' });
        label('brandTube', { show: railShown, x: 102, y: 48, size: TYPE.heading, width: 84, align: 'left', bold: true, color: COLOR.coral, initial: 'TUBE' });
        const tabs = [
            { id: 'home', title: 'Home', y: 112, icon: 'home' },
            { id: 'trending', title: 'Trending', y: 192, icon: 'trending' },
            { id: 'music', title: 'Music', y: 272, icon: 'note' },
            { id: 'search', title: 'Search', y: 352, icon: 'search' },
            { id: 'library', title: 'Library', y: 432, icon: 'library' }
        ];
        tabs.forEach(tab => {
            button('tab_' + tab.id, { x: 16, y: tab.y, w: 190, h: 72, show: railShown, quick: true,
                action: call('nav', tab.id), look: f => ({ style: 'nav', icon: tab.icon, selected: f.tab === tab.id }) });
            label('tab_' + tab.id + 'Text', { x: 76, y: tab.y + 36, size: TYPE.heading, width: 128, align: 'left', initial: tab.title, owner: 'tab_' + tab.id,
                show: railShown, fill: f => f.tab === tab.id ? COLOR.text : COLOR.text2, weight: f => f.tab === tab.id });
        });
        button('close', { x: 16, y: 568, w: 190, h: 80, show: railShown, quick: true, action: call('close'), look: () => ({ style: 'outline', icon: 'close' }) });
        label('closeText', { x: 76, y: 608, size: TYPE.heading, width: 128, align: 'left', initial: 'Close', owner: 'close', color: COLOR.text2, show: railShown });

        label('brandPro', { show: railShown, x: 28, y: 80, size: TYPE.small, width: 160, align: 'left', color: COLOR.accent, bold: true, initial: 'PRO' });

        // The one Back button: same place, size and wording on every screen
        // that has somewhere to go back to (the player draws its own copy at
        // the same spot over the video; see PLAYER in overlay.js).
        button('back', { x: BACK.x, y: BACK.y, w: BACK.w, h: BACK.h, show: f => f.back && f.screen !== 'player', action: call('back'), look: () => ({ style: 'secondary', icon: 'back', iconLeft: true }) });
        label('backText', { x: BACK.x + 92, y: BACK.y + BACK.h / 2, size: TYPE.body, width: 80, initial: 'Back', owner: 'back', bold: true });
        label('screenTitle', { x: LEFT, y: 52, size: TYPE.title, width: 560, align: 'left', bold: true, show: f => f.showTitle && !!f.title, text: f => f.title,
            place: f => ({ x: f.back ? BACK.x + BACK.w + 20 : LEFT, y: 40 }) });
        label('screenSub', { x: LEFT, y: 80, size: TYPE.meta, width: 560, align: 'left', color: COLOR.text2, show: f => f.showTitle && !!f.sub, text: f => f.sub,
            place: f => ({ x: f.back ? BACK.x + BACK.w + 20 : LEFT, y: 76 }) });

        // Home and Music shelves.
        button('homeUp', { x: 1064, y: 16, w: 72, h: 64, quick: true, show: f => f.homeLike && content(f) && f.homeRows > 2, enabled: f => f.homeUp,
            action: call('homePage', -1), look: f => ({ style: 'secondary', icon: 'up', disabled: !f.homeUp }) });
        button('homeDown', { x: 1144, y: 16, w: 72, h: 64, quick: true, show: f => f.homeLike && content(f) && f.homeRows > 2, enabled: f => f.homeDown,
            action: call('homePage', 1), look: f => ({ style: 'secondary', icon: 'down', disabled: !f.homeDown }) });
        label('homePage', { x: 1048, y: 48, size: TYPE.meta, width: 300, align: 'right', color: COLOR.text3, show: f => f.homeLike && content(f) && f.homeRows > 2, text: f => f.homePage });
        for (let s = 0; s < 2; s++) {
            const shelf = (f) => f.shelves[s];
            const top = SHELF_TOP[s];
            label('shelfTitle' + s, { x: LEFT, y: top + 32, size: TYPE.heading, width: 520, align: 'left', bold: true,
                show: f => f.homeLike && content(f) && !!shelf(f), text: f => shelf(f) ? shelf(f).title : '' });
            label('shelfSub' + s, { x: 940, y: top + 32, size: TYPE.meta, width: 160, align: 'right', color: COLOR.text3,
                show: f => f.homeLike && content(f) && !!shelf(f) && shelf(f).pages > 1, text: f => shelf(f) ? shelf(f).page : '' });
            button('shelfPrev' + s, { x: 956, y: top, w: 72, h: 64, quick: true, show: f => f.homeLike && content(f) && !!shelf(f) && shelf(f).pages > 1,
                enabled: f => shelf(f) && shelf(f).offset > 0, action: call('shelfPage', s, -1),
                look: f => ({ style: 'secondary', icon: 'back', disabled: !(shelf(f) && shelf(f).offset > 0) }) });
            button('shelfNext' + s, { x: 1036, y: top, w: 72, h: 64, quick: true, show: f => f.homeLike && content(f) && !!shelf(f) && shelf(f).pages > 1,
                enabled: f => shelf(f) && shelf(f).offset + 4 < shelf(f).row.items.length, action: call('shelfPage', s, 1),
                look: f => ({ style: 'secondary', icon: 'chevron', disabled: !(shelf(f) && shelf(f).offset + 4 < shelf(f).row.items.length) }) });
            button('shelfAll' + s, { x: 1116, y: top, w: 100, h: 64, show: f => f.homeLike && content(f) && !!shelf(f),
                action: call('shelfAll', s), look: () => ({ style: 'secondary' }) });
            label('shelfAllText' + s, { x: 1166, y: top + 32, size: TYPE.meta, width: 92, initial: 'See all', owner: 'shelfAll' + s, bold: true });
            for (let t = 0; t < 4; t++) {
                const id = 'card' + s + '_' + t, card = (f) => f.shelves[s] && f.shelves[s].cards[t], x = LEFT + t * CARD_PITCH, y = top + 72;
                button(id, { x: x, y: y, w: CARD_W, h: CARD_H, show: f => f.homeLike && content(f) && !!card(f), action: call('card', s, t), look: () => ({ style: 'card' }) });
                label(id + 'Title1', { x: x + 10, y: y + THUMB_H + 20, size: TYPE.body, width: CARD_W - 20, align: 'left', bold: true, owner: id,
                    show: f => f.homeLike && content(f) && !!card(f), text: f => card(f).line1 });
                label(id + 'Title2', { x: x + 10, y: y + THUMB_H + 47, size: TYPE.body, width: CARD_W - 20, align: 'left', bold: true, owner: id,
                    show: f => f.homeLike && content(f) && !!card(f) && !!card(f).line2, text: f => card(f).line2 });
                label(id + 'Sub', { x: x + 10, y: y + THUMB_H + 74, size: TYPE.meta, width: CARD_W - 20, align: 'left', color: COLOR.text2, owner: id,
                    show: f => f.homeLike && content(f) && !!card(f), text: f => card(f).sub });
                label(id + 'Dur', { x: x + CARD_W - 12, y: y + THUMB_H - 20, size: TYPE.small, width: 84, align: 'right', bold: true,
                    owner: id, show: f => f.homeLike && content(f) && !!card(f) && !!card(f).duration, text: f => card(f).duration });
            }
        }
        button('musicSearch', { x: LEFT, y: 16, w: 252, h: 64, show: f => f.screen === 'music' && content(f), action: call('musicSearchOpen'),
            look: () => ({ style: 'secondary', icon: 'search', iconLeft: true }) });
        label('musicSearchText', { x: LEFT + 144, y: 48, size: TYPE.meta, width: 180, owner: 'musicSearch', initial: 'Search music', bold: true });
        label('homeEmpty', { x: MID, y: 320, size: TYPE.heading, width: 860, color: COLOR.text2,
            show: f => f.homeLike && content(f) && !f.loading && !f.shelves.some(Boolean), text: f => f.screen === 'music' ? 'No music to show right now.' : 'No videos to show right now.' });

        // Search keyboard.
        label('searchQuery', { x: LEFT + 28, y: 58, size: TYPE.title, width: 760, align: 'left', show: f => f.screen === 'search',
            text: f => f.query || (f.searchMode === 'music' ? 'Search music' : 'Search videos'), fill: f => f.query ? COLOR.text : COLOR.text3,
            place: f => ({ x: f.back ? BACK.x + BACK.w + 44 : LEFT + 28, y: 58, width: f.back ? 590 : 760 }) });
        button('searchClear', { x: 1056, y: 22, w: 72, h: 72, quick: true, show: f => f.screen === 'search' && !!f.query, action: call('key', 'clear'),
            look: () => ({ style: 'key', icon: 'close' }) });
        button('searchVoice', { x: 1136, y: 22, w: 80, h: 72, show: f => f.screen === 'search', action: call('voice'),
            look: () => ({ style: 'key', icon: 'mic' }) });
        for (let i = 0; i < 4; i++) {
            button('recent' + i, { x: LEFT + i * CARD_PITCH, y: 106, w: CARD_W, h: 64, show: f => f.screen === 'search' && !!f.recent[i],
                enabled: f => !f.searchBusy, action: () => this.actions.recent(i), look: () => ({ style: 'chip', icon: 'history', iconLeft: true }) });
            label('recent' + i + 'Text', { x: LEFT + i * CARD_PITCH + 44, y: 138, size: TYPE.meta, width: CARD_W - 54, align: 'left', owner: 'recent' + i,
                show: f => f.screen === 'search' && !!f.recent[i], text: f => f.recent[i] });
        }
        LETTERS.forEach((letters, r) => letters.split('').forEach((letter, c) => {
            const x = KEYS.start[r] + c * (KEYS.w + KEYS.gap), y = KEYS.y[r];
            button('key' + r + '_' + c, { x: x, y: y, w: KEYS.w, h: KEYS.h, quick: true, show: f => f.screen === 'search',
                action: () => this.actions.key((this.state.symbols ? SYMBOLS : LETTERS)[r][c]), look: () => ({ style: 'key' }) });
            label('key' + r + '_' + c + 'Text', { x: x + KEYS.w / 2, y: y + KEYS.h / 2, size: TYPE.title, width: KEYS.w - 8, owner: 'key' + r + '_' + c,
                text: f => (f.state.symbols ? SYMBOLS : LETTERS)[r][c].toUpperCase() });
        }));
        const special = (id, x, w, title, action, style, icon, enabled) => {
            button(id, { x: x, y: SPECIAL_Y, w: w, h: SPECIAL_H, show: f => f.screen === 'search', action: action, enabled: enabled, quick: id !== 'keyGo',
                look: f => ({ style: id === 'keyGo' && !f.query ? 'secondary' : style || 'keyAlt', icon: icon || '', iconLeft: style === 'primary', busy: id === 'keyGo' && f.searchBusy }) });
            if (title) label(id + 'Text', { x: x + w / 2 + (style === 'primary' ? 18 : 0), y: SPECIAL_Y + SPECIAL_H / 2, size: TYPE.body, width: w - (style === 'primary' ? 64 : 16), initial: title, owner: id,
                bold: id === 'keyGo', color: id === 'keyGo' ? COLOR.onAccent : COLOR.text, fill: id === 'keyGo' ? (f => f.query ? COLOR.onAccent : COLOR.text) : undefined,
                text: id === 'keySymbols' ? (f => f.state.symbols ? 'ABC' : '123') : id === 'keyGo' ? (f => f.searchBusy ? 'Searching…' : 'Search') : undefined });
        };
        special('keySymbols', LEFT, 112, '123', call('key', 'symbols'));
        special('keySpace', LEFT + 124, 440, 'Space', call('key', 'space'));
        special('keyBack', LEFT + 576, 112, '', call('key', 'backspace'), 'keyAlt', 'backspace');
        special('keyGo', LEFT + 700, W - 700, 'Search', call('search'), 'primary', 'search', f => !f.searchBusy);
        button('modeAll', { x: LEFT, y: 528, w: 150, h: 64, show: f => f.screen === 'search', action: call('setSearchMode', 'all'),
            look: f => ({ style: 'chip', selected: f.searchMode !== 'music' }) });
        label('modeAllText', { x: LEFT + 75, y: 560, size: TYPE.meta, width: 130, owner: 'modeAll', initial: 'Videos', bold: true,
            fill: f => f.searchMode !== 'music' ? COLOR.text : COLOR.text2 });
        button('modeMusic', { x: LEFT + 162, y: 528, w: 150, h: 64, show: f => f.screen === 'search', action: call('setSearchMode', 'music'),
            look: f => ({ style: 'chip', selected: f.searchMode === 'music' }) });
        label('modeMusicText', { x: LEFT + 237, y: 560, size: TYPE.meta, width: 130, owner: 'modeMusic', initial: 'Music', bold: true,
            fill: f => f.searchMode === 'music' ? COLOR.text : COLOR.text2 });
        label('searchTip', { x: LEFT + 336, y: 560, size: TYPE.small, width: 640, align: 'left', color: COLOR.text3, show: f => f.screen === 'search',
            text: f => f.searchMode === 'music' ? 'Searching music only. Tap Videos for everything.' : 'Tip: tap the mic and say what you want to watch.' });

        // Voice.
        label('voiceTitle', { x: MID, y: 380, size: TYPE.display, width: 700, bold: true, show: f => f.screen === 'voice', initial: 'Listening…' });
        label('voiceSub', { x: MID, y: 432, size: TYPE.heading, width: 800, color: COLOR.text2, show: f => f.screen === 'voice',
            text: f => f.voiceText || 'Say what you want to watch' });
        button('voiceCancel', { x: MID - 150, y: 560, w: 300, h: 88, show: f => f.screen === 'voice', action: call('cancelVoice'), look: () => ({ style: 'secondary', icon: 'close', iconLeft: true }) });
        label('voiceCancelText', { x: MID + 22, y: 604, size: TYPE.body, width: 220, owner: 'voiceCancel', initial: 'Stop listening', bold: true });

        // Results.
        label('resultsTitle', { x: BACK.x + BACK.w + 20, y: 40, size: TYPE.title, width: 560, align: 'left', bold: true, show: f => f.screen === 'results', text: f => f.resultsTitle,
            place: f => ({ x: f.back ? BACK.x + BACK.w + 20 : LEFT, y: 40 }) });
        label('resultsSub', { x: BACK.x + BACK.w + 20, y: 76, size: TYPE.meta, width: 560, align: 'left', color: COLOR.text2, show: f => f.screen === 'results', text: f => f.resultsSub,
            place: f => ({ x: f.back ? BACK.x + BACK.w + 20 : LEFT, y: 76 }) });
        button('resPrev', { x: 984, y: 16, w: 72, h: 64, quick: true, show: f => f.screen === 'results' && f.resultsPages > 1, enabled: f => f.resultsPage > 0,
            action: call('page', -1), look: f => ({ style: 'secondary', icon: 'back', disabled: !(f.resultsPage > 0) }) });
        button('resNext', { x: 1144, y: 16, w: 72, h: 64, quick: true, show: f => f.screen === 'results' && f.resultsPages > 1, enabled: f => f.resultsHasNext,
            action: call('page', 1), look: f => ({ style: 'secondary', icon: 'chevron', disabled: !f.resultsHasNext }) });
        label('resPage', { x: 1100, y: 48, size: TYPE.meta, width: 84, color: COLOR.text2, show: f => f.screen === 'results' && f.resultsPages > 1, text: f => f.resultsPageLabel });
        for (let i = 0; i < 4; i++) {
            const id = 'result' + i, row = (f) => f.results[i], y = ROW_TOP + i * RESULT_PITCH;
            button(id, { x: LEFT, y: y, w: W, h: ROW_H, show: f => f.screen === 'results' && !!row(f), action: call('result', i), look: () => ({ style: 'row' }) });
            label(id + 'Title', { x: LEFT + 232, y: y + 30, size: TYPE.body + 2, width: W - 252, align: 'left', bold: true, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).title });
            label(id + 'Sub', { x: LEFT + 232, y: y + 66, size: TYPE.meta, width: W - 252, align: 'left', color: COLOR.text2, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).channel });
            label(id + 'Meta', { x: LEFT + 232, y: y + 98, size: TYPE.small, width: W - 252, align: 'left', color: COLOR.text3, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).meta });
            label(id + 'Dur', { x: LEFT + 200, y: y + 100, size: TYPE.small, width: 84, align: 'right', bold: true, owner: id,
                show: f => f.screen === 'results' && !!row(f) && !!row(f).duration, text: f => row(f).duration });
        }
        // One panel for "searching", "nothing found" and search errors.
        label('resultsNoteTitle', { x: MID, y: 290, size: TYPE.heading + 2, width: 860, bold: true, show: f => f.screen === 'results' && !!f.resultsNote, text: f => f.resultsNote.title });
        for (let i = 0; i < 2; i++) {
            label('resultsNoteBody' + i, { x: MID, y: 334 + i * 34, size: TYPE.body, width: 860, color: COLOR.text2,
                show: f => f.screen === 'results' && !!f.resultsNote && !!f.resultsNote.lines && !!f.resultsNote.lines[i], text: f => f.resultsNote.lines[i] });
        }
        button('resultsAction', { x: MID - 160, y: 412, w: 320, h: 88, show: f => f.screen === 'results' && !!f.resultsNote && !!f.resultsNote.label,
            enabled: f => !f.loading, action: call('resultsAction'), look: f => ({ style: 'primary', icon: f.resultsNote && f.resultsNote.icon, iconLeft: true }) });
        label('resultsActionText', { x: MID + 20, y: 456, size: TYPE.body, width: 240, bold: true, color: COLOR.onAccent, owner: 'resultsAction', text: f => f.resultsNote ? f.resultsNote.label : '' });

        // Details.
        button('dHeroPlay', { x: LEFT, y: 108, w: 420, h: 236, show: f => f.screen === 'details' && !!f.detail, enabled: f => f.detail && f.detail.canPlay,
            action: call('play'), look: () => ({ style: 'none' }) });
        label('dKind', { x: LEFT + 18, y: 130, size: TYPE.small, width: 120, align: 'left', bold: true,
            show: f => f.screen === 'details' && f.detail && f.detail.music, initial: 'MUSIC' });
        label('dTitle1', { x: 692, y: 124, size: TYPE.title - 2, width: 540, align: 'left', bold: true, show: f => f.screen === 'details', text: f => f.detail ? f.detail.title1 : '' });
        label('dTitle2', { x: 692, y: 160, size: TYPE.title - 2, width: 540, align: 'left', bold: true, show: f => f.screen === 'details' && f.detail && !!f.detail.title2,
            text: f => f.detail ? f.detail.title2 : '' });
        label('dChannel', { x: 692, y: 198, size: TYPE.body, width: 540, align: 'left', color: COLOR.accent, show: f => f.screen === 'details', text: f => f.detail ? f.detail.channel : '' });
        label('dMeta', { x: 692, y: 230, size: TYPE.meta, width: 540, align: 'left', color: COLOR.text2, show: f => f.screen === 'details', text: f => f.detail ? f.detail.meta : '' });
        button('dPlay', { x: 692, y: 256, w: 252, h: 88, show: f => f.screen === 'details', enabled: f => f.detail && f.detail.canPlay, action: call('play'),
            place: f => ({ x: 692, y: 256, w: f.detail && f.detail.error ? 380 : 252, h: 88 }),
            look: f => ({ style: 'primary', icon: f.detail && f.detail.playIcon, iconLeft: true, disabled: !(f.detail && f.detail.canPlay), busy: f.detail && f.detail.busy }) });
        label('dPlayText', { x: 692 + 126 + 20, y: 300, size: TYPE.body + 2, width: 300, bold: true, color: COLOR.onAccent, owner: 'dPlay', text: f => f.detail ? f.detail.playLabel : 'Play',
            place: f => f.detail && f.detail.error ? { x: 692 + 190 + 20, y: 300, width: 300 } : { x: 692 + 126 + 20, y: 300, width: 184 } });
        button('dLike', { x: 960, y: 256, w: 196, h: 88, show: f => f.screen === 'details' && f.detail && f.detail.loaded, action: call('like'),
            look: f => ({ style: 'toggle', icon: 'heart', iconLeft: true, selected: f.detail && f.detail.liked }) });
        label('dLikeText', { x: 960 + 98 + 20, y: 300, size: TYPE.body, width: 130, bold: true, owner: 'dLike', text: f => f.detail && f.detail.liked ? 'Liked' : 'Like',
            fill: f => f.detail && f.detail.liked ? COLOR.coral : COLOR.text });
        label('dStatus', { x: 692, y: 376, size: TYPE.small, width: 540, align: 'left', show: f => f.screen === 'details' && f.detail && !!f.detail.statusText,
            text: f => f.detail ? f.detail.statusText : '', fill: f => f.detail && f.detail.statusColor || COLOR.text3 });
        label('dErrorTitle', { x: 692, y: 384, size: TYPE.heading, width: 540, align: 'left', bold: true, color: COLOR.danger,
            show: f => f.screen === 'details' && f.detail && !!f.detail.error, text: f => f.detail && f.detail.error ? f.detail.error.title : '' });
        for (let i = 0; i < 2; i++) {
            label('dErrorBody' + i, { x: 692, y: 422 + i * 32, size: TYPE.body, width: 540, align: 'left', color: COLOR.text2,
                show: f => f.screen === 'details' && f.detail && !!f.detail.error && !!f.detail.errorLines[i], text: f => f.detail && f.detail.errorLines ? f.detail.errorLines[i] : '' });
        }
        for (let i = 0; i < 4; i++) {
            label('dDesc' + i, { x: 692, y: 420 + i * 32, size: TYPE.meta, width: 540, align: 'left', color: COLOR.text3,
                show: f => f.screen === 'details' && !!f.detail && !f.detail.error && !!f.detail.desc[i], text: f => f.detail ? f.detail.desc[i] : '' });
        }
        label('dRelTitle', { x: LEFT, y: 388, size: TYPE.heading, width: 260, align: 'left', bold: true, show: f => f.screen === 'details' && f.detail && f.detail.related.length > 0, initial: 'Up next' });
        label('dRelPage', { x: 504, y: 388, size: TYPE.meta, width: 120, align: 'right', color: COLOR.text3, show: f => f.screen === 'details' && f.detail && f.detail.relPages > 1,
            text: f => f.detail ? (f.detail.relPage + 1) + ' of ' + f.detail.relPages : '' });
        button('dRelPrev', { x: 516, y: 356, w: 72, h: 64, quick: true, show: f => f.screen === 'details' && f.detail && f.detail.relPages > 1,
            enabled: f => f.detail && f.detail.relPage > 0, action: call('relatedPage', -1), look: f => ({ style: 'secondary', icon: 'up', disabled: !(f.detail && f.detail.relPage > 0) }) });
        button('dRelNext', { x: 596, y: 356, w: 72, h: 64, quick: true, show: f => f.screen === 'details' && f.detail && f.detail.relPages > 1,
            enabled: f => f.detail && f.detail.relPage + 1 < f.detail.relPages, action: call('relatedPage', 1),
            look: f => ({ style: 'secondary', icon: 'down', disabled: !(f.detail && f.detail.relPage + 1 < f.detail.relPages) }) });
        for (let i = 0; i < 3; i++) {
            const id = 'rel' + i, rel = (f) => f.detail && f.detail.related[i], y = 428 + i * 80;
            button(id, { x: LEFT, y: y, w: 420, h: 72, show: f => f.screen === 'details' && !!rel(f), action: call('related', i), look: () => ({ style: 'row' }) });
            label(id + 'Title', { x: LEFT + 136, y: y + 23, size: TYPE.meta, width: 272, align: 'left', bold: true, owner: id,
                show: f => f.screen === 'details' && !!rel(f), text: f => rel(f).line1 });
            label(id + 'Sub', { x: LEFT + 136, y: y + 50, size: TYPE.meta, width: 272, align: 'left', bold: true, owner: id,
                show: f => f.screen === 'details' && !!rel(f) && !!rel(f).line2, text: f => rel(f).line2 });
        }

        // Library.
        for (let s = 0; s < 2; s++) {
            const shelf = (f) => f.library[s], top = SHELF_TOP[s];
            label('libTitle' + s, { x: LEFT, y: top + 32, size: TYPE.heading, width: 600, align: 'left', bold: true,
                show: f => f.screen === 'library' && !f.libEmpty && !!shelf(f), text: f => shelf(f) ? shelf(f).title : '' });
            for (let t = 0; t < 4; t++) {
                const id = 'libCard' + s + '_' + t, card = (f) => f.library[s] && f.library[s].cards[t], x = LEFT + t * CARD_PITCH, y = top + 72;
                button(id, { x: x, y: y, w: CARD_W, h: CARD_H, show: f => f.screen === 'library' && !f.libConfirm && !!card(f), action: call('libCard', s, t), look: () => ({ style: 'card' }) });
                label(id + 'Title1', { x: x + 10, y: y + THUMB_H + 20, size: TYPE.body, width: CARD_W - 20, align: 'left', bold: true, owner: id,
                    show: f => f.screen === 'library' && !!card(f), text: f => card(f).line1 });
                label(id + 'Title2', { x: x + 10, y: y + THUMB_H + 47, size: TYPE.body, width: CARD_W - 20, align: 'left', bold: true, owner: id,
                    show: f => f.screen === 'library' && !!card(f) && !!card(f).line2, text: f => card(f).line2 });
                label(id + 'Sub', { x: x + 10, y: y + THUMB_H + 74, size: TYPE.meta, width: CARD_W - 20, align: 'left', color: COLOR.text2, owner: id,
                    show: f => f.screen === 'library' && !!card(f), text: f => card(f).sub });
                label(id + 'Dur', { x: x + CARD_W - 12, y: y + THUMB_H - 20, size: TYPE.small, width: 84, align: 'right', bold: true,
                    owner: id, show: f => f.screen === 'library' && !!card(f) && !!card(f).duration, text: f => card(f).duration });
            }
            label('libShelfEmpty' + s, { x: LEFT, y: top + 128, size: TYPE.body, width: 940, align: 'left', color: COLOR.text3,
                show: f => f.screen === 'library' && !f.libEmpty && !f.libConfirm && !!shelf(f) && !shelf(f).cards.length,
                text: f => s === 0 ? 'Videos you start will show up here.' : 'Tap Like on a video to keep it here.' });
        }
        button('libClear', { x: 1004, y: 16, w: 212, h: 64, show: f => f.screen === 'library' && f.historyCount > 0 && !f.libConfirm,
            action: call('clearHistory'), look: () => ({ style: 'secondary', icon: 'close', iconLeft: true }) });
        label('libClearText', { x: 1130, y: 48, size: TYPE.meta, width: 150, owner: 'libClear', initial: 'Clear history', bold: true });
        // Clearing history is a separate, explicit confirmation.
        label('libConfirmTitle', { x: MID, y: 268, size: TYPE.title, width: 600, bold: true, show: f => f.screen === 'library' && f.libConfirm, initial: 'Clear watch history?' });
        label('libConfirmBody', { x: MID, y: 314, size: TYPE.body, width: 600, color: COLOR.text2, show: f => f.screen === 'library' && f.libConfirm, initial: 'Liked videos stay. This cannot be undone.' });
        button('libConfirmYes', { x: MID - 264, y: 368, w: 256, h: 88, show: f => f.screen === 'library' && f.libConfirm, enabled: f => f.libArmed,
            action: call('confirmClearHistory'), look: f => ({ style: 'danger', disabled: !f.libArmed }) });
        label('libConfirmYesText', { x: MID - 136, y: 412, size: TYPE.body, width: 230, bold: true, owner: 'libConfirmYes', initial: 'Clear history', color: 0x2A0B07 });
        button('libConfirmNo', { x: MID + 8, y: 368, w: 256, h: 88, show: f => f.screen === 'library' && f.libConfirm, action: call('cancelClearHistory'),
            look: () => ({ style: 'secondary' }) });
        label('libConfirmNoText', { x: MID + 136, y: 412, size: TYPE.body, width: 230, bold: true, owner: 'libConfirmNo', initial: 'Keep it' });
        label('libEmpty', { x: MID, y: 300, size: TYPE.heading, width: 860, bold: true, show: f => f.screen === 'library' && f.libEmpty, initial: 'Nothing here yet' });
        label('libEmptyBody', { x: MID, y: 344, size: TYPE.body, width: 860, color: COLOR.text2, show: f => f.screen === 'library' && f.libEmpty,
            initial: 'Videos you watch, and videos you like, show up here.' });
        button('libEmptyGo', { x: MID - 160, y: 396, w: 320, h: 88, show: f => f.screen === 'library' && f.libEmpty, action: call('nav', 'home'),
            look: () => ({ style: 'primary', icon: 'search', iconLeft: true }) });
        label('libEmptyGoText', { x: MID + 20, y: 440, size: TYPE.body, width: 240, bold: true, color: COLOR.onAccent, owner: 'libEmptyGo', initial: 'Find videos' });

        // Player. Controls are drawn by overlay.js over the video and seen
        // through holes; these are their transparent hit areas, at the
        // overlay's own PLAYER geometry so drawing and touch always agree.
        const P = require('./overlay').PLAYER;
        const live = f => f.screen === 'player' && !!f.player;
        const shown = f => live(f) && !f.player.ended && !f.player.settingsOpen && (f.player.controlsVisible || f.player.paused) && !f.player.starting;
        const settingsShown = f => live(f) && f.player.settingsOpen && !f.player.ended;
        const area = (id, r, show, action, enabled, quick) => button(id, { x: r.x, y: r.y, w: r.w, h: r.h, show: show, action: action, enabled: enabled, quick: !!quick, look: () => ({ style: 'none' }) });
        // A tap on the picture shows the controls, or hides them when shown.
        area('pScreenTap', { x: 0, y: 0, w: 1280, h: 720 }, f => live(f) && !f.player.settingsOpen && !f.player.ended && !f.player.starting, call('screenTap'));
        // Back is always available, even while a video is starting.
        area('pBack', P.back, f => live(f) && (f.player.ended || f.player.starting || f.player.settingsOpen || f.player.controlsVisible || f.player.paused), call('playerBack'));
        area('pBack10', P.back10, shown, call('seek', -10));
        area('pToggle', P.play, shown, call('togglePlay'));
        area('pFwd10', P.fwd10, shown, call('seek', 10));
        area('pCaptions', P.captions, shown, call('toggleCaptions'));
        area('pSettings', P.settings, shown, call('toggleSettings'));
        area('pNext', P.next, f => shown(f) && !!f.player.nextTitle, call('next'));
        area('pVolDown', P.volDown, shown, call('volumeDown'), null, true);
        area('pVolUp', P.volUp, shown, call('volumeUp'), null, true);
        // While paused, the big card in the middle resumes.
        area('pResume', P.pausedCard, f => live(f) && f.player.paused && !f.player.settingsOpen && !f.player.ended && !f.player.starting, call('togglePlay'));
        for (let i = 0; i < P.seekSegments; i++) {
            const w = P.scrub.w / P.seekSegments;
            area('pSeek' + i, { x: Math.round(P.scrub.x + i * w), y: P.scrub.y, w: Math.round(P.scrub.x + (i + 1) * w) - Math.round(P.scrub.x + i * w), h: P.scrub.h }, shown, call('seekTo', (i + 0.5) / P.seekSegments));
        }
        area('pSetPanel', { x: 0, y: 0, w: 1280, h: 720 }, settingsShown, call('closeSettings'));
        area('pCapOff', P.settingsRows[0].off, settingsShown, call('toggleCaptions', false));
        area('pCapOn', P.settingsRows[0].on, settingsShown, call('toggleCaptions', true));
        area('pLoopOff', P.settingsRows[1].off, settingsShown, call('setLoop', false));
        area('pLoopOn', P.settingsRows[1].on, settingsShown, call('setLoop', true));
        area('pAutoOff', P.settingsRows[2].off, settingsShown, call('setAutoplay', false));
        area('pAutoOn', P.settingsRows[2].on, settingsShown, call('setAutoplay', true));
        area('pSetClose', P.done, settingsShown, call('closeSettings'));
        // Starting and finished states are drawn by BE itself (no video).
        const startingWords = require('./overlay').startingWords;
        label('playerTitle', { x: 640, y: 262, size: TYPE.heading, width: 860, bold: true, show: f => live(f) && f.player.starting && !f.player.session,
            text: f => f.player ? f.player.title : '' });
        label('playerStatus', { x: 640, y: 318, size: TYPE.heading, width: 760, show: f => live(f) && f.player.starting && !f.player.session,
            text: f => startingWords(f.player).title, color: COLOR.text2 });
        label('playerStatusBody', { x: 640, y: 412, size: TYPE.meta, width: 760, show: f => live(f) && f.player.starting && !f.player.session,
            text: f => startingWords(f.player).body, color: COLOR.text3 });
        label('pBackText', { x: P.back.x + 98, y: P.back.y + P.back.h / 2, size: TYPE.body, width: 80, bold: true, initial: 'Back',
            show: f => live(f) && (f.player.ended || (f.player.starting && !f.player.session)) });
        label('pEndTitle', { x: 640, y: 236, size: TYPE.small, width: 560, color: COLOR.accent, bold: true, show: f => live(f) && f.player.ended,
            text: f => f.player && f.player.nextTitle ? 'UP NEXT' : 'VIDEO FINISHED' });
        label('pEndNext', { x: 640, y: 280, size: TYPE.heading + 2, width: 560, bold: true, show: f => live(f) && f.player.ended,
            text: f => f.player ? (f.player.nextTitle || f.player.title || '') : '' });
        label('pEndCount', { x: 640, y: 324, size: TYPE.meta, width: 560, color: COLOR.text2, show: f => live(f) && f.player.ended,
            text: f => f.player ? (f.player.nextTitle ? (f.player.autoplayIn > 0 ? 'Plays in ' + f.player.autoplayIn + ' s' : 'Autoplay is off') : 'Watch it again or go back.') : '' });
        button('pPlayNext', { x: 652, y: 368, w: 248, h: 88, show: f => live(f) && f.player.ended && !!f.player.nextTitle, action: call('playNext'),
            look: () => ({ style: 'primary', icon: 'next', iconLeft: true }) });
        label('pPlayNextText', { x: 652 + 124 + 20, y: 412, size: TYPE.body, width: 180, bold: true, color: COLOR.onAccent, owner: 'pPlayNext', initial: 'Play next' });
        button('pReplay', { x: 380, y: 368, w: 248, h: 88, show: f => live(f) && f.player.ended, action: call('replay'),
            look: f => ({ style: f.player && f.player.nextTitle ? 'secondary' : 'primary', icon: 'repeat', iconLeft: true }), place: f => ({ x: f.player && f.player.nextTitle ? 380 : 516, y: 368 }) });
        label('pReplayText', { x: 380 + 124 + 20, y: 412, size: TYPE.body, width: 180, bold: true, owner: 'pReplay', initial: 'Replay',
            place: f => ({ x: (f.player && f.player.nextTitle ? 380 : 516) + 144, y: 412 }), fill: f => f.player && f.player.nextTitle ? COLOR.text : COLOR.onAccent });

        // Full-screen status (loading and errors). One message, one button.
        label('statusTitle', { x: MID, y: 280, size: TYPE.title + 2, width: 860, bold: true, show: f => !!f.status, text: f => f.status ? f.status.title : '' });
        for (let i = 0; i < 2; i++) {
            label('statusBody' + i, { x: MID, y: 328 + i * 36, size: TYPE.body + 2, width: 860, color: COLOR.text2, show: f => !!f.status && !!f.status.lines && !!f.status.lines[i],
                text: f => f.status && f.status.lines ? f.status.lines[i] : '' });
        }
        button('statusAction', { x: MID - 170, y: 408, w: 340, h: 88, show: f => !!f.status && !!f.status.label, enabled: f => !!f.status && !f.status.busy,
            action: call('statusAction'), look: f => ({ style: 'primary', icon: f.status && f.status.action === 'close' ? 'close' : f.status && f.status.action === 'back' ? 'back' : 'repeat', iconLeft: true }) });
        label('statusActionText', { x: MID + 22, y: 452, size: TYPE.body + 2, width: 260, bold: true, color: COLOR.onAccent, owner: 'statusAction',
            text: f => f.status ? f.status.label : '' });
        label('storageNote', { x: LEFT, y: 48, size: TYPE.small, width: 740, align: 'left', color: COLOR.sponsor,
            show: f => f.screen === 'library' && !!f.storageNote && !f.libConfirm, text: f => f.storageNote });
        label('toast', { x: MID, y: 664, size: TYPE.meta, width: 900, show: f => !!f.toast, text: f => f.toast,
            place: f => ({ x: f.toastX, y: 664, width: f.toastX === MID ? 900 : 520 }) });

        // Art slots.
        for (let s = 0; s < 2; s++) for (let t = 0; t < 4; t++) {
            this.slot('cardArt' + s + '_' + t, { owner: 'card' + s + '_' + t, x: 0, y: 0, w: CARD_W, h: THUMB_H, radius: 14, pill: true,
                show: f => f.homeLike && !f.status && !!(f.shelves[s] && f.shelves[s].cards[t]),
                url: f => f.shelves[s] && f.shelves[s].cards[t] ? f.shelves[s].cards[t].thumbUrl : '',
                pillData: f => f.shelves[s] && f.shelves[s].cards[t] ? { duration: f.shelves[s].cards[t].duration, progress: f.shelves[s].cards[t].progress, size: TYPE.small } : null });
            this.slot('libArt' + s + '_' + t, { owner: 'libCard' + s + '_' + t, x: 0, y: 0, w: CARD_W, h: THUMB_H, radius: 14, pill: true,
                show: f => f.screen === 'library' && !f.libConfirm && !!(f.library[s] && f.library[s].cards[t]),
                url: f => f.library[s] && f.library[s].cards[t] ? f.library[s].cards[t].thumbUrl : '',
                pillData: f => f.library[s] && f.library[s].cards[t] ? { duration: f.library[s].cards[t].duration, progress: f.library[s].cards[t].progress, size: TYPE.small } : null });
        }
        for (let i = 0; i < 4; i++) this.slot('resultArt' + i, { owner: 'result' + i, x: 8, y: 8, w: 200, h: 112, radius: 10, pill: true,
            show: f => f.screen === 'results' && !!f.results[i], url: f => f.results[i] ? f.results[i].thumbUrl : '',
            pillData: f => f.results[i] ? { duration: f.results[i].duration, progress: 0, size: TYPE.small } : null });
        this.slot('heroArt', { owner: 'dHeroPlay', x: 0, y: 0, w: 420, h: 236, radius: 16, overlay: 'hero',
            show: f => f.screen === 'details' && !!f.detail, url: f => f.detail ? f.detail.thumbUrl : '' });
        for (let i = 0; i < 3; i++) this.slot('relArt' + i, { owner: 'rel' + i, x: 8, y: 6, w: 112, h: 60, radius: 8,
            show: f => f.screen === 'details' && !!(f.detail && f.detail.related[i]), url: f => f.detail && f.detail.related[i] ? f.detail.related[i].thumbUrl : '' });

        return { viewConfig: { type: 'View', id: 'jibotube', category: 'gui', ignoreSwipeDown: true, transitionStageOnly: true },
            componentConfigs: this.groupConfigs.base.slice() };
    }

    slot(id, spec) { spec = Object.assign({ id: id }, spec); spec.group = this.groupOfId(spec.owner); this.slots[id] = spec; }

    groupOfId(id) {
        if (/^(brand|tab_|close|back|screenTitle|screenSub|status|toast)/.test(id)) return 'base';
        if (/^p[A-Z]/.test(id) || /^player/.test(id)) return 'player';
        if (/^(d[A-Z]|dDesc|dRel|rel|heroArt)/.test(id)) return 'details';
        if (/^lib/.test(id)) return 'library';
        if (/^(results|res|result)/.test(id)) return 'results';
        if (/^voice/.test(id)) return 'voice';
        if (/^(search|recent|key|mode)/.test(id)) return 'search';
        if (/^(shelf|card|home|music)/.test(id)) return 'home';
        return 'base';
    }

    compute(state) {
        const f = { state: state, screen: state.screen, tab: state.tab, loading: state.loading, query: state.query || '',
            recent: (state.recentSearches || []).slice(0, 4), back: false, showTitle: false, title: '', sub: '',
            shelves: [], library: [], cards: [], results: [], resultPage: state.resultsPage || 0,
            homeLike: state.screen === 'home' || state.screen === 'music', searchMode: state.searchMode || 'all',
            homeUp: false, homeDown: false, homePage: '', homeRows: 0, shelfTops: SHELF_TOP.slice(),
            toast: state.toast && Date.now() - state.toastAt < 4200 && (!state.toastScreen || state.toastScreen === state.screen + '|' + (state.detailId || '')) ? state.toast : '',
            toastX: state.screen === 'details' ? 962 : MID,
            status: null, player: state.player, detail: null, resultsNote: null, resultsPages: 1,
            historyCount: state.library ? state.library.history.length : 0, libConfirm: !!state.libConfirm,
            libArmed: !!state.libConfirm && Date.now() - (state.libConfirmAt || 0) >= 600,
            searchBusy: !!state.searchBusy };
        if (f.homeLike && (state.home || state.musicHome)) {
            const source = f.screen === 'music' ? state.musicHome : state.home;
            const rows = source ? (source.rows || []) : [];
            const top = Math.max(0, Math.min(f.screen === 'music' ? (state.musicHomeTop || 0) : (state.homeTop || 0), Math.max(0, rows.length - 2)));
            f.homeRows = rows.length;
            f.homeUp = top > 0; f.homeDown = top + 2 < rows.length;
            f.homePage = rows.length > 2 ? 'Shelves ' + (top + 1) + '–' + Math.min(rows.length, top + 2) + ' of ' + rows.length : '';
            for (let s = 0; s < 2; s++) {
                const row = rows[top + s];
                if (!row) { f.shelves.push(null); continue; }
                const offset = Math.max(0, Math.min(state.shelfOffsets[row.id] || 0, Math.max(0, row.items.length - 1)));
                const items = row.items.slice(offset, offset + 4);
                const pages = Math.max(1, Math.ceil(row.items.length / 4));
                f.shelves.push({ title: plain(row.title), row: row, offset: offset, pages: pages,
                    page: pages > 1 ? (Math.floor(offset / 4) + 1) + ' of ' + pages : '', cards: items.map(item => this.card(item)) });
            }
        } else if (f.screen === 'voice') {
            f.back = true;
        } else if (f.screen === 'search') {
            f.back = state.searchFrom === 'music';
        } else if (f.screen === 'results') {
            const result = state.results || { title: 'Results', items: [] };
            const page = f.resultPage = f.resultsPage = Math.max(0, state.resultsPage || 0);
            const items = result.items.slice(page * 4, page * 4 + 4);
            f.results = items.map(item => this.row(item));
            f.resultsTitle = plain(result.title) || 'Results';
            const count = result.items.length, noun = result.music ? (count === 1 ? ' song' : ' songs') : (count === 1 ? ' video' : ' videos');
            f.resultsPages = Math.max(1, Math.ceil(count / 4));
            f.resultsSub = state.loading ? 'Searching…' : result.error ? '' : count ? count + noun : '';
            f.resultsPageLabel = (page + 1) + ' of ' + f.resultsPages;
            f.resultsHasNext = (page + 1) * 4 < count;
            if (state.loading) f.resultsNote = { title: 'Searching…', body: 'Looking for ' + (result.query ? '“' + plain(result.query) + '”' : 'videos') + '.', label: '' };
            else if (result.error || (state.status && state.status.code && !count)) {
                const info = statusInfo(result.error ? { code: result.error, retryable: result.retryable } : state.status, { context: 'results' });
                f.resultsNote = { title: info.title, body: info.body, label: info.label, icon: info.retry ? 'repeat' : 'search', code: info.code, retry: info.retry, action: info.action };
            } else if (!count) {
                f.resultsNote = { title: NO_RESULTS.title, body: NO_RESULTS.body, label: result.query ? 'Search again' : '', icon: 'search', code: 'no_results', action: 'back' };
            }
            if (f.resultsNote) f.resultsNote.lines = this.lines(f.resultsNote.body, 860, TYPE.body, false, 2);
            f.back = !!result.back;
        } else if (f.screen === 'details' && state.details) {
            const d = state.details, v = d.video;
            const lines = this.lines(v.title, 532, TYPE.title - 2, true, 2);
            const job = state.prepare || {};
            // A failure arrives as state.prepare (reason) and/or state.status
            // (code, retryable); either is shown here, never full screen.
            const statusError = state.status && state.status.code && STATUS[statusCode(state.status, 'details')] &&
                ['retry', 'video', 'close'].indexOf(STATUS[statusCode(state.status, 'details')].kind) >= 0 ? state.status : null;
            const failed = job.state === 'error' || !!statusError;
            const error = failed ? statusInfo(job.state === 'error' ? { code: job.reason || job.code, retryable: statusError ? statusError.retryable : job.retryable } : statusError, { context: 'details' }) : null;
            const relPage = state.relatedPage || 0, related = (d.related || []);
            const relPages = Math.max(1, Math.ceil(related.length / 3));
            const starting = !!(state.player && state.player.starting);
            const loaded = job.state === 'ready' || failed || !!d.loaded;
            let playLabel = state.resumePosition > 0 ? 'Resume' : 'Play', playIcon = 'play';
            if (error) { playLabel = error.label || 'Back'; playIcon = error.action === 'retry' ? 'repeat' : error.action === 'close' ? 'close' : 'back'; }
            if (starting) playLabel = 'Starting…';
            const sponsors = d.sponsor && d.sponsor.segments ? d.sponsor.segments.length : 0;
            f.detail = {
                title1: lines[0], title2: lines[1], channel: plain(v.channel) || ' ',
                meta: [v.views ? views(v.views) : '', ago(v.published), clock(job.cleanDuration || v.duration)].filter(Boolean).join(' · '),
                likes: v.likes ? (v.likes >= 1000 ? (v.likes / 1000).toFixed(1).replace(/\.0$/, '') + 'K likes' : v.likes + ' likes') : '',
                desc: loaded ? this.lines(v.description || 'No description.', 532, TYPE.meta, false, 4) : ['Loading details…', '', '', ''],
                liked: !!(state.liked), thumbUrl: state.thumbUrl, loaded: loaded && !error,
                sponsorText: sponsors ? 'Sponsor messages will be skipped' : '',
                statusText: error ? '' : job.state === 'preparing' ? (job.detail || 'Getting the video ready…') : sponsors ? 'Sponsor messages will be skipped' : '',
                statusColor: job.state === 'preparing' ? COLOR.text3 : COLOR.sponsor,
                busy: starting || job.state === 'preparing', job: job, error: error, errorText: error ? error.body : '',
                errorLines: error ? this.lines(error.body, 532, TYPE.body, false, 2) : ['', ''],
                canPlay: !starting && !!v && job.state !== 'preparing',
                playLabel: playLabel, playIcon: playIcon, action: error ? error.action : 'play',
                music: !!state.detailsMusic,
                related: related.slice(relPage * 3, relPage * 3 + 3).map(item => { const two = this.lines(item.title, 262, TYPE.meta, true, 2);
                    return { title: plain(item.title), line1: two[0], line2: two[1], sub: plain(item.channel || ''), thumbUrl: item.thumbUrl || '' }; }),
                relPage: relPage, relPages: relPages
            };
            if (error && state.detailsMusic && error.kind === 'video') { f.detail.errorLines = this.lines("This track can't play here. Pick another one.", 532, TYPE.body, false, 2); f.detail.errorText = "This track can't play here. Pick another one."; }
            f.back = true;
        } else if (f.screen === 'library' && state.library) {
            const library = state.library;
            const continueItems = library.history.filter(item => item.position > 0).slice(0, 8);
            const liked = library.likes.slice(0, 8);
            const shelves = [{ title: 'Continue watching', items: continueItems }, { title: 'Liked videos', items: liked }];
            f.library = shelves.map(shelf => ({ title: shelf.title, cards: shelf.items.map(item => this.card(item)) }));
            f.libEmpty = !f.libConfirm && !f.library.some(shelf => shelf.cards.length) && !library.history.length;
            f.storageNote = state.storageWarning ? statusInfo('storage_unavailable').title + '. ' + statusInfo('storage_unavailable').body : '';
        }
        // Full-screen status only on the loading/error screens; elsewhere a
        // failure is shown where it happened (details, results).
        if (state.status && (f.screen === 'loading' || f.screen === 'error')) {
            const info = statusInfo(state.status.code ? state.status : (state.status.busy ? 'loading' : 'service_unavailable'), { context: 'screen', canBack: !!state.errorReturn });
            const busy = !!state.status.busy || info.busy;
            f.status = { title: info.title, body: info.body, action: busy ? '' : info.action, label: busy ? '' : info.label, busy: busy, code: info.code };
            f.status.lines = this.lines(f.status.body, 860, TYPE.body + 2, false, 2);
            if (f.screen === 'error' && state.errorReturn) f.back = true;
        }
        if (state.loading && f.screen === 'loading' && !f.status) {
            f.status = { title: STATUS.loading.title, body: STATUS.loading.body, label: '', busy: true, code: 'loading' };
            f.status.lines = [STATUS.loading.body, ''];
        }
        f.bgKey = [f.shelves.map(shelf => shelf ? shelf.cards.map(card => card && card.id + ':' + card.duration + ':' + Math.round((card.progress || 0) * 100)).join(',') : '').join('|'),
            f.library.map(shelf => shelf.cards.map(card => card && card.id).join(',')).join('|')].join('#');
        return f;
    }

    card(item) {
        if (!item) return null;
        const lines = this.lines(item.title, CARD_W - 24, TYPE.body, true, 2);
        return { id: item.id, title: item.title, channel: item.channel, line1: lines[0], line2: lines[1],
            sub: plain(item.channel || '') || (item.views ? views(item.views) : ''), duration: item.duration ? clock(item.duration) : '', thumbUrl: item.thumbUrl || '',
            progress: item.progress || (item.duration && item.position ? Math.min(1, item.position / item.duration) : 0) };
    }
    row(item) {
        return { id: item.id, title: plain(item.title), channel: plain(item.channel || ''),
            meta: [item.views ? views(item.views) : '', ago(item.published)].filter(Boolean).join(' · '),
            duration: item.duration ? clock(item.duration) : '', thumbUrl: item.thumbUrl || '' };
    }
    thumbOf(item) { return item && item.thumbUrl || ''; }

    available(control) { try { return !control.enabled || !!control.enabled(this.frame); } catch (_) { return false; } }
    visible(control) { try { return !control.show || !!control.show(this.frame); } catch (_) { return false; } }
    enabled(control) { return this.available(control); }
    // Every tap (real, verbal or remote) arrives here. A double tap's second
    // tap is dropped: on a button that just appeared, or right after another
    // action. Harmless repeatable controls (marked quick) always respond.
    press(id) {
        const control = this.byId[id];
        this.setPressed('');
        if (!control || !control.button || !this.visible(control) || !this.available(control) || !this.actions.allowed()) return;
        const now = Date.now();
        if (!control.quick && (now - (this.shownAt[id] || 0) < TAP_SETTLE_MS || now - this.lastActionAt < TAP_SETTLE_MS)) return;
        if (!control.quick) this.lastActionAt = now;
        control.action();
    }
    // Pressed feedback: the native Button reports touch down/up on its display.
    setPressed(id) {
        if (this.pressed === id) return;
        const old = this.pressed; this.pressed = id;
        [old, id].forEach(cid => { if (cid && this.shapes[cid] && this.rects[cid] && this.frame) { const c = this.byId[cid]; this.paint(c, this.rects[cid], this.frame, true); } });
    }

    decorate(view, PIXI, timers) {
        this.view = view; this.PIXI = PIXI; this.timers = timers || null;
        this.background = new PIXI.Graphics(); view.stage.addChildAt(this.background, 0);
        this.progress = new PIXI.Graphics(); view.stage.addChild(this.progress);
        this.attachShapes('base');
        this.attachSlots(this.screenGroup);
        this.toastBox = new PIXI.Graphics(); view.stage.addChild(this.toastBox);
        if (PIXI.Texture && PIXI.BaseTexture && global.Image && timers) {
            this.art = new ArtCache(PIXI, { timers: timers, changed: () => { if (this.state) this.paintArt(this.frame); } });
        }
        this.controls.filter(control => !control.button).forEach(control => this.set(control, control.initial || ''));
    }

    groupForScreen(screen) {
        if (screen === 'music') return 'home';
        if (screen === 'home' || screen === 'search' || screen === 'voice' || screen === 'results' ||
            screen === 'details' || screen === 'library' || screen === 'player') return screen;
        return 'base';
    }
    attachShapes(group) {
        this.controls.filter(control => control.button && this.groupOfId(control.id) === group).forEach(control => {
            if (this.shapes[control.id]) return;
            const component = this.view.getComponentById(control.id);
            if (!component || !component.display) return;
            const shape = new this.PIXI.Graphics();
            component.display.addChildAt ? component.display.addChildAt(shape, 0) : component.display.addChild(shape);
            this.shapes[control.id] = shape;
            const display = component.display;
            let painted = true;
            try { painted = !control.look || control.look(this.frame || {}).style !== 'none'; } catch (_) { painted = true; }
            if (typeof display.on === 'function' && painted) {
                ['mousedown', 'touchstart'].forEach(name => display.on(name, () => this.setPressed(control.id)));
                ['mouseup', 'mouseupoutside', 'mouseout', 'touchend', 'touchendoutside'].forEach(name => display.on(name, () => { if (this.pressed === control.id) this.setPressed(''); }));
            }
        });
    }
    attachSlot(id) {
        const slot = this.slots[id], owner = this.view.getComponentById(slot.owner);
        if (!owner || !owner.display || slot.holder) return;
        const PIXI = this.PIXI;
        const holder = new PIXI.Container(), placeholder = new PIXI.Graphics(), sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        const mask = new PIXI.Graphics();
        draw.roundedRect(mask, 0, 0, slot.w, slot.h, slot.radius || 0, 0xFFFFFF, 1);
        holder.position.x = slot.x; holder.position.y = slot.y; sprite.visible = false;
        holder.addChild(placeholder); holder.addChild(sprite);
        if (slot.pill) { slot.pillGraphics = new PIXI.Graphics(); holder.addChild(slot.pillGraphics); }
        if (slot.overlay === 'hero') { slot.overlayGraphics = new PIXI.Graphics(); holder.addChild(slot.overlayGraphics); }
        // Behind the owner's labels, above its background shape.
        if (owner.display.children && owner.display.children.length && owner.display.addChildAt) {
            owner.display.addChildAt(holder, Math.min(1, owner.display.children.length));
        } else owner.display.addChild(holder);
        owner.display.addChild(mask);
        holder.mask = mask;
        slot.holder = holder; slot.placeholder = placeholder; slot.sprite = sprite; slot.mask = mask; slot.drawn = '';
    }
    attachSlots(group) {
        Object.keys(this.slots).forEach(id => { if (this.slots[id].group === group) this.attachSlot(id); });
    }
    detachSlots(group) {
        Object.keys(this.slots).forEach(id => {
            const slot = this.slots[id];
            if (slot.group !== group) return;
            if (slot.sprite && this.PIXI) { slot.sprite.texture = this.PIXI.Texture.EMPTY; slot.sprite.visible = false; }
            if (slot.holder && slot.holder.parent) slot.holder.parent.removeChild(slot.holder);
            if (slot.mask && slot.mask.parent) slot.mask.parent.removeChild(slot.mask);
            slot.holder = null; slot.mask = null; slot.sprite = null; slot.placeholder = null;
            slot.pillGraphics = null; slot.overlayGraphics = null; slot.drawn = '';
        });
    }
    setScreen(group) {
        if (!this.view || group === this.screenGroup) return;
        const old = this.screenGroup;
        this.pressed = '';
        if (old !== 'base') this.detachSlots(old);
        if (old !== 'base') (this.groupConfigs[old] || []).forEach(config => {
            const component = this.view.getComponentById(config.id);
            if (component) {
                try { this.view.removeComponent(config.id); } catch (_) {}
                try { if (component.display && component.display.parent) component.display.parent.removeChild(component.display); } catch (_) {}
                try { component.destroy(); } catch (_) {}
            }
            delete this.shapes[config.id]; delete this.cache[config.id]; delete this.rects[config.id]; delete this.shownAt[config.id];
        });
        this.screenGroup = group;
        if (group === 'base') return;
        const creator = this.views && this.views.creator;
        if (!creator) return;
        (this.groupConfigs[group] || []).forEach(config => {
            let component;
            try { component = creator.createComponentFromConfig(config); } catch (_) { component = null; }
            if (!component) return;
            try { component.createDisplay(this.view.stage, this.view._assets || {}); } catch (_) { return; }
            this.view.addComponent(component);
            if (this.view.componentConfigs) this.view.componentConfigs.push(config);
            if (config.type === 'Label') this.set(this.byId[config.id], config.text || '');
        });
        this.attachShapes(group);
        this.attachSlots(group);
        // Base controls drawn above screen content (Back, status, toast).
        ['back', 'backText', 'toast', 'statusTitle', 'statusBody', 'statusAction', 'statusActionText'].forEach(id => {
            const component = this.view.getComponentById(id);
            if (component && component.display && component.display.parent) component.display.parent.addChild(component.display);
        });
    }

    releaseArt() {
        this.released = true;
        Object.keys(this.slots).forEach(id => {
            const slot = this.slots[id];
            if (slot.sprite && this.PIXI) { slot.sprite.texture = this.PIXI.Texture.EMPTY; slot.sprite.visible = false; }
            if (slot.holder && slot.holder.parent) slot.holder.parent.removeChild(slot.holder);
            if (slot.mask && slot.mask.parent) slot.mask.parent.removeChild(slot.mask);
        });
        if (this.art) this.art.destroy();
        this.art = null;
    }

    set(control, value, width) {
        const label = this.view.getComponentById(control.id);
        if (!label || !label.style) return;
        const limit = Math.max(16, Math.min(control.width, width || control.width) - 6);
        const key = (value || '') + '|' + limit + '|' + label.style.fontWeight;
        if (this.cache[control.id] === key) return;
        this.cache[control.id] = key;
        label.style.fontSize = control.size;
        const string = plain(value || '') || (value === ' ' ? ' ' : '');
        const measure = sample => this.PIXI.TextMetrics.measureText(sample, label.style).width;
        let result = string;
        if (string && measure(string) > limit) {
            const characters = Array.from(string); let low = 0, high = characters.length;
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (measure(characters.slice(0, middle).join('').replace(/\s+$/, '') + '…') <= limit) low = middle;
                else high = middle - 1;
            }
            result = characters.slice(0, low).join('').replace(/\s+$/, '') + '…';
        }
        label.text = result;
    }

    render(state) {
        this.state = state;
        if (!this.view || this.view.state === 'destroyed' || !this.PIXI || !this.progress) return;
        const group = this.groupForScreen(state.screen);
        if (group !== this.screenGroup) this.setScreen(group);
        const f = this.frame = this.compute(state);
        this.paintBackground(f);
        this.controls.forEach(control => {
            const component = this.view.getComponentById(control.id);
            if (!component || !component.display) return;
            const visible = this.visible(control);
            component.display.visible = visible;
            if (control.button) {
                const enabled = visible && this.available(control);
                component.lockInput(!enabled);
                if (!enabled) { delete this.shownAt[control.id]; if (!visible) return; }
                const before = this.rects[control.id];
                const rect = this.place(control, component, f);
                // When a target appears (or moves) under a finger, start its settle time.
                if (enabled && (!this.shownAt[control.id] || !before || before.x !== rect.x || before.y !== rect.y)) this.shownAt[control.id] = Date.now();
                component.display.alpha = 1;
                this.paint(control, rect, f, true);
                return;
            }
            if (!visible) return;
            const owner = control.owner && this.byId[control.owner];
            if (owner && !this.visible(owner)) { component.display.visible = false; return; }
            component.display.alpha = 1;
            let width = control.width;
            if (control.place) {
                const at = control.place(f);
                component.display.position.x = at.x; component.display.position.y = at.y;
                if (at.width) width = at.width;
            }
            if (control.fill || control.weight) {
                const fill = control.fill ? hex(control.fill(f)) : null, weight = control.weight ? (control.weight(f) ? 'bold' : 'normal') : null;
                if (fill && component.style.fill !== fill) component.style.fill = fill;
                if (weight && component.style.fontWeight !== weight) component.style.fontWeight = weight;
            }
            if (owner && owner.look) {
                // Labels on a disabled button are dimmed with it.
                let look = null; try { look = owner.look(f); } catch (_) { look = null; }
                component.display.alpha = look && look.disabled ? 0.55 : 1;
            }
            if (control.text) {
                let value = '';
                try { value = control.text(f); } catch (_) { value = ''; }
                this.set(control, value, width);
            }
        });
        this.paintProgress(f);
        this.paintArt(f);
        this.paintToast(f);
    }

    place(control, component, f) {
        let rect = { x: control.x, y: control.y, w: control.w, h: control.h };
        if (control.place) { const at = control.place(f); rect = { x: at.x, y: at.y, w: at.w || control.w, h: at.h || control.h }; }
        component.display.position.x = rect.x; component.display.position.y = rect.y;
        const hit = component.display.hitArea;
        if (!hit || hit.width !== rect.w || hit.height !== rect.h) component.display.hitArea = new this.PIXI.Rectangle(0, 0, rect.w, rect.h);
        this.rects[control.id] = rect;
        return rect;
    }

    paint(control, rect, f, enabled) {
        let look;
        try { look = control.look ? control.look(f) : { style: 'none' }; } catch (_) { look = { style: 'none' }; }
        const shape = this.shapes[control.id];
        if (!shape) return;
        const pressed = this.pressed === control.id && !look.disabled;
        const key = JSON.stringify([look, rect.w, rect.h, pressed, look.busy ? Math.floor(Date.now() / 250) % 4 : 0]);
        if (shape.paintKey === key) return;
        shape.paintKey = key;
        const g = shape.clear(), w = rect.w, h = rect.h, s = look.style;
        if (s === 'none') return;
        if (s === 'nav') {
            if (look.selected || pressed) { draw.roundedRect(g, 0, 0, w, h, 18, pressed ? COLOR.raisedHi : COLOR.raised, 1); }
            if (look.selected) draw.roundedRect(g, 0, 12, 6, h - 24, 3, COLOR.accent, 1);
            draw.icon(g, look.icon, 18, h / 2 - 18, 36, look.selected ? COLOR.text : COLOR.text2);
            return;
        }
        if (s === 'outline') {
            draw.roundedRect(g, 0, 0, w, h, 18, pressed ? COLOR.raisedHi : COLOR.surface, 1);
            draw.icon(g, look.icon, 20, h / 2 - 16, 32, COLOR.text2);
            return;
        }
        if (s === 'card') {
            draw.roundedRect(g, 0, 0, w, h, 16, pressed ? COLOR.raisedHi : COLOR.card, 1);
            if (pressed) draw.roundedRect(g, 0, h - 5, w, 5, 2, COLOR.accent, 1);
            return;
        }
        if (s === 'row') {
            draw.roundedRect(g, 0, 0, w, h, 14, pressed ? COLOR.raisedHi : COLOR.surface, 1);
            draw.roundedRect(g, 0, 10, 5, h - 20, 2, pressed ? COLOR.accent : COLOR.line2, 1);
            return;
        }
        if (s === 'chip') {
            draw.roundedRect(g, 0, 0, w, h, 16, look.selected ? COLOR.accentDark : pressed ? COLOR.raisedHi : COLOR.raised, 1);
            if (look.selected) draw.roundedRect(g, 0, h - 5, w, 5, 2, COLOR.accent, 1);
            if (look.icon) draw.icon(g, look.icon, 12, h / 2 - 12, 24, COLOR.text3);
            return;
        }
        if (s === 'key' || s === 'keyAlt') {
            draw.roundedRect(g, 0, 0, w, h, 12, pressed ? COLOR.raisedHi : s === 'key' ? COLOR.raised : COLOR.surface, 1);
            if (look.icon) draw.icon(g, look.icon, w / 2 - 17, h / 2 - 17, 34, COLOR.text);
            return;
        }
        if (s === 'primary') {
            const fill = look.disabled ? COLOR.accentDark : pressed ? COLOR.accentHi : COLOR.accent;
            draw.roundedRect(g, 0, 0, w, h, 16, fill, 1);
            if (look.busy) {
                // Busy: a moving bar along the bottom edge instead of the icon.
                const phase = Math.floor(Date.now() / 250) % 4;
                draw.roundedRect(g, 12 + phase * (w - 24) / 4, h - 12, (w - 24) / 4, 6, 3, COLOR.onAccent, 0.85);
            } else if (look.icon) draw.icon(g, look.icon, look.iconLeft ? 22 : w / 2 - 17, h / 2 - 17, 34, look.disabled ? COLOR.disabled : COLOR.onAccent);
            return;
        }
        if (s === 'danger') {
            draw.roundedRect(g, 0, 0, w, h, 16, look.disabled ? 0x8A4A40 : pressed ? 0xFFA08C : 0xFF8A72, 1);
            return;
        }
        if (s === 'secondary' || s === 'toggle') {
            draw.roundedRect(g, 0, 0, w, h, 16, pressed ? COLOR.raisedHi : COLOR.raised, 1);
            if (look.icon) {
                const size = Math.min(34, h - 30), color = look.disabled ? COLOR.disabled : s === 'toggle' && look.selected ? COLOR.coral : COLOR.text;
                draw.icon(g, look.icon, look.iconLeft ? 20 : w / 2 - size / 2, h / 2 - size / 2, size, color);
            }
            return;
        }
    }

    paintBackground(f) {
        const key = [f.screen, f.tab, f.loading, f.status ? f.status.title : '', f.player && f.player.starting, f.player && !!f.player.session, f.player && f.player.ended,
            f.libConfirm, f.query ? 1 : 0, f.back, f.bgKey || ''].join('|');
        if (this.background.paintKey === key) return;
        this.background.paintKey = key;
        const g = this.background.clear().lineStyle(0, 0, 0);
        // The player's controls show through holes in the video: plain black.
        if (f.screen === 'player') {
            g.beginFill(0x000000, 1).drawRect(0, 0, 1280, 720).endFill();
            if (f.player && f.player.ended) {
                draw.roundedRect(g, 340, 196, 600, 292, 28, COLOR.surface, 1);
                draw.roundedRect(g, 340, 196, 600, 6, 3, COLOR.accent, 1);
            }
            if (f.player && (f.player.ended || (f.player.starting && !f.player.session))) {
                const P = require('./overlay').PLAYER;
                draw.roundedRect(g, P.back.x, P.back.y, P.back.w, P.back.h, 16, COLOR.raised, 1);
                draw.icon(g, 'back', P.back.x + 20, P.back.y + P.back.h / 2 - 17, 34, COLOR.text);
            }
            return;
        }
        g.beginFill(0x08181E, 1).drawRect(0, 0, 1280, 720).endFill();
        for (let i = 0; i < 18; i++) g.beginFill(COLOR.accent, 0.006 + i * 0.0022).drawRect(220, i * 12, 1060, 12).endFill();
        if (f.screen !== 'voice') {
            g.beginFill(COLOR.rail, 1).drawRect(0, 0, 222, 720).endFill();
            g.beginFill(COLOR.line, 0.55).drawRect(222, 0, 2, 720).endFill();
        }
        if (f.screen === 'search') {
            const x = f.back ? BACK.x + BACK.w + 16 : LEFT;
            draw.roundedRect(g, x, 16, RIGHT - x, 84, 18, COLOR.raised, 1);
            if (!f.query) draw.roundedRect(g, (f.back ? BACK.x + BACK.w + 44 : LEFT + 28) - 6, 36, 3, 44, 1, COLOR.accent, 0.9);
        }
        if (f.screen === 'details' && f.detail) draw.roundedRect(g, LEFT - 3, 105, 426, 242, 18, COLOR.line, 0.75);
        if (f.screen === 'voice') draw.roundedRect(g, 380, 80, 720, 600, 36, COLOR.surface, 0.8);
        if (f.screen === 'library' && f.libConfirm) {
            draw.roundedRect(g, 430, 210, 620, 272, 28, COLOR.surface, 1);
            draw.roundedRect(g, 430, 210, 620, 6, 3, COLOR.dangerFill, 1);
        }
        if (f.status) {
            draw.roundedRect(g, 300, 200, 880, f.status.label ? 326 : 236, 28, COLOR.surface, 0.94);
            draw.roundedRect(g, 300, 200, 880, 6, 3, f.status.busy ? COLOR.accent : COLOR.danger, 1);
        }
    }

    paintProgress(f) {
        const g = this.progress.clear().lineStyle(0, 0, 0);
        if (f.screen === 'voice') {
            const phase = Date.now() / 180;
            const bars = 9, base = MID - (bars - 1) * 22;
            for (let i = 0; i < bars; i++) {
                const level = 0.25 + 0.75 * Math.abs(Math.sin(phase + i * 0.55));
                const height = 18 + level * 70;
                g.beginFill(COLOR.accent, 0.55 + level * 0.45).drawRect(base + i * 44 - 7, 500 - height / 2, 14, height).endFill();
            }
            g.beginFill(COLOR.accent, 1); draw.disc(g, MID, 228, 92); g.endFill();
            draw.icon(g, 'mic', MID - 40, 228 - 40, 80, COLOR.onAccent);
        }
        // Busy screens get a moving bar so "still working" is never a frozen screen.
        const busyBar = (x, y, w) => {
            const phase = (Date.now() % 1600) / 1600;
            draw.roundedRect(g, x, y, w, 8, 4, COLOR.line, 1);
            draw.roundedRect(g, x + phase * (w - w / 4), y, w / 4, 8, 4, COLOR.accent, 1);
        };
        if (f.status && f.status.busy) busyBar(MID - 200, 420, 400);
        if (f.screen === 'results' && f.loading) busyBar(MID - 200, 420, 400);
        if (f.screen === 'player' && f.player && f.player.starting && !f.player.session) busyBar(440, 360, 400);
        if (f.screen === 'details' && f.detail && !f.detail.loaded && !f.detail.error) busyBar(692, 446, 300);
        if (f.screen === 'details' && f.detail && f.detail.job && f.detail.job.state === 'preparing') {
            const progress = Math.max(0, Math.min(1, Number(f.detail.job.progress) || 0));
            draw.roundedRect(g, 692, 396, 540, 8, 4, COLOR.line, 1);
            draw.roundedRect(g, 692, 396, Math.max(8, 540 * progress), 8, 4, COLOR.accent, 1);
        }
    }

    paintToast(f) {
        if (!this.toastBox) return;
        const g = this.toastBox.clear();
        if (!f.toast) return;
        const label = this.view.getComponentById('toast');
        const max = f.toastX === MID ? 920 : 540;
        const width = Math.min(max, (label && label.style ? this.PIXI.TextMetrics.measureText(label.text, label.style).width : 500) + 56);
        draw.roundedRect(g, f.toastX - width / 2, 636, width, 56, 16, COLOR.raisedHi, 0.98);
        draw.roundedRect(g, f.toastX - width / 2, 636, 6, 56, 3, COLOR.accent, 1);
    }

    paintArt(f) {
        if (!f || !this.PIXI) return;
        const wanted = [];
        Object.keys(this.slots).forEach(id => {
            const slot = this.slots[id];
            if (!slot.holder) return;
            const owner = slot.owner && this.byId[slot.owner];
            let visible = !owner || this.visible(owner);
            let url = '';
            try { if (visible) visible = !slot.show || !!slot.show(f); url = visible ? slot.url(f) || '' : ''; } catch (_) { visible = false; }
            slot.holder.visible = visible;
            if (slot.overlayGraphics) slot.overlayGraphics.clear();
            if (slot.pillGraphics) {
                slot.pillGraphics.clear();
                if (visible && slot.pillData) { try { const pill = slot.pillData(f); if (pill && pill.duration) {
                    const pw = Math.max(58, Math.ceil(this.measure(pill.duration, pill.size || TYPE.small, true)) + 16);
                    draw.roundedRect(slot.pillGraphics, slot.w - pw - 6, slot.h - 36, pw, 30, 8, 0x000000, 0.78);
                    if (pill.progress > 0) {
                        slot.pillGraphics.beginFill(0x000000, 0.6).drawRect(0, slot.h - 5, slot.w, 5).endFill();
                        slot.pillGraphics.beginFill(COLOR.coral, 1).drawRect(0, slot.h - 5, slot.w * Math.min(1, pill.progress), 5).endFill();
                    }
                } } catch (_) {} }
            }
            if (!visible) { if (slot.sprite.visible) { slot.sprite.visible = false; slot.sprite.texture = this.PIXI.Texture.EMPTY; } return; }
            if (url) wanted.push(url);
            const texture = this.art && url ? this.art.texture(url) : null;
            const hero = () => {
                if (!slot.overlayGraphics) return;
                const detail = f.detail, can = detail && detail.canPlay;
                slot.overlayGraphics.beginFill(0x000000, 0.28); slot.overlayGraphics.drawRect(0, 0, slot.w, slot.h); slot.overlayGraphics.endFill();
                slot.overlayGraphics.beginFill(can ? COLOR.accent : COLOR.disabled, 0.95); draw.disc(slot.overlayGraphics, slot.w / 2, slot.h / 2, 44); slot.overlayGraphics.endFill();
                draw.icon(slot.overlayGraphics, detail && detail.playIcon === 'repeat' ? 'repeat' : 'play', slot.w / 2 - 18, slot.h / 2 - 18, 36, COLOR.onAccent);
            };
            if (texture) {
                const scale = Math.max(slot.w / Math.max(1, texture.width), slot.h / Math.max(1, texture.height));
                slot.sprite.texture = texture; slot.sprite.scale.x = scale; slot.sprite.scale.y = scale;
                slot.sprite.position.x = (slot.w - texture.width * scale) / 2; slot.sprite.position.y = (slot.h - texture.height * scale) / 2;
                slot.sprite.visible = true; slot.placeholder.visible = false;
                hero();
            } else {
                if (slot.sprite.visible) { slot.sprite.visible = false; slot.sprite.texture = this.PIXI.Texture.EMPTY; }
                slot.placeholder.visible = true;
                if (slot.drawn !== 'empty') {
                    // Calm placeholder: a flat tile with the play glyph (same
                    // while loading and when the picture is unavailable).
                    slot.drawn = 'empty';
                    const g = slot.placeholder.clear().lineStyle(0, 0, 0);
                    draw.roundedRect(g, 0, 0, slot.w, slot.h, slot.radius || 0, COLOR.raised, 1);
                    const size = Math.min(48, slot.h * 0.4);
                    draw.icon(g, 'play', slot.w / 2 - size / 2, slot.h / 2 - size / 2, size, COLOR.text3);
                }
                hero();
            }
        });
        if (this.art) this.art.want(wanted);
    }

    layoutDump() {
        if (!this.view || !this.frame) return null;
        const out = [];
        this.controls.forEach(control => {
            const component = this.view.getComponentById(control.id);
            if (!component || !component.display || !component.display.visible) return;
            const d = component.display;
            if (control.button) out.push({ id: control.id, type: 'button', x: d.position.x, y: d.position.y, w: d.hitArea.width, h: d.hitArea.height,
                enabled: !component.inputLocked, primary: !!(control.look && (() => { try { const l = control.look(this.frame); return l.style === 'primary' || l.style === 'danger'; } catch (_) { return false; } })()) });
            else {
                const owner = control.owner && this.byId[control.owner];
                if (owner && !this.visible(owner)) return;
                out.push({ id: control.id, type: 'label', x: d.position.x, y: d.position.y, text: component.text, size: component.style.fontSize, align: control.align,
                    width: component.text ? this.PIXI.TextMetrics.measureText(component.text, component.style).width : 0, limit: control.width, owner: control.owner || '' });
            }
        });
        return { screen: this.frame.screen, controls: out };
    }
}

module.exports = { UI: UI, LETTERS: LETTERS, SYMBOLS: SYMBOLS, COLOR: COLOR, TYPE: TYPE, STATUS: STATUS, statusCode: statusCode, statusInfo: statusInfo,
    clock: clock, views: views, ago: ago, splitTitle: splitTitle, wrap: wrap, fitLines: fitLines, BACK: BACK };
