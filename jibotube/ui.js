'use strict';

const draw = require('./draw');
const ArtCache = require('./art').ArtCache;

const FONT = 'Proxima Nova Soft';
const COLOR = {
    bg0: 0x07151B, bg1: 0x0A1E26, rail: 0x08181E, surface: 0x0F252D, raised: 0x17343E, card: 0x102830,
    line: 0x234650, line2: 0x2E5A65, text: 0xFFFFFF, text2: 0xB7D2D9, text3: 0x7E9CA6,
    accent: 0x2FD0C0, accentDark: 0x0E6E67, coral: 0xFF6B5A, onAccent: 0x03211E, danger: 0xFF8C7D,
    sponsor: 0xFFB84D
};
const LEFT = 248, RIGHT = 1256, W = RIGHT - LEFT, MID = 752;
const CARD_W = 238, CARD_H = 134, CARD_GAP = 18, CARD_PITCH = CARD_W + CARD_GAP;
const SHELF_TOP = [100, 400];
const ROW_H = 128, RESULT_PITCH = 142;
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', '-/:;()&@"', '.,?!\'#+'];
const KEYS = { y: [176, 258, 340], h: 72, w: 88, gap: 8 };
const SPECIAL_Y = 424;

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
function plain(value) { return String(value || '').replace(/[\uD800-\uDFFF\uFE0F\u200D\u2600-\u27BF]/g, ''); }
function shorten(value, length) {
    const s = plain(value).replace(/\s+/g, ' ').trim();
    return s.length > length ? s.slice(0, length - 1).replace(/\s+$/, '') + '…' : s;
}
function splitTitle(value, width) {
    const s = plain(value).replace(/\s+/g, ' ').trim();
    if (!s) return ['', ''];
    if (s.length <= width) return [s, ''];
    let cut = s.lastIndexOf(' ', width);
    if (cut < width * 0.55) cut = width;
    const first = s.slice(0, cut).trim();
    const rest = s.slice(cut).trim();
    return [first, rest.length > width ? rest.slice(0, width - 1).replace(/\s+$/, '') + '…' : rest];
}
function wrap(value, width, lines) {
    const words = plain(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const out = [];
    let line = '';
    words.forEach(word => {
        if (out.length >= lines) return;
        if ((line + ' ' + word).trim().length > width && line) {
            out.push(line);
            line = word;
            return;
        }
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
        this.controlGroup = {}; this.screenGroup = 'base';
    }

    config(views) {
        this.views = views;
        const components = [];
        const label = (id, spec) => {
            const c = Object.assign({ id: id, button: false, align: 'center', size: 26, color: COLOR.text, bold: false }, spec || {});
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
                hitArea: { x: 0, y: 0, width: c.w || 40, height: c.h || 40 },
                action: { type: views.ActionData.CALLBACK, data: { callback: () => this.press(id) } } };
            components.push(config);
            const group = this.groupOfId(id); this.controlGroup[id] = group; this.groupConfigs[group].push(config);
            return c;
        };
        const call = (name, ...args) => () => this.actions[name].apply(null, args);
        const panel = (name) => (f) => f.screen === name;

        // Brand and rail.
        label('brandJibo', { show: f => f.screen !== 'player', x: 26, y: 48, size: 28, width: 78, align: 'left', bold: true, initial: 'JIBO' });
        label('brandTube', { show: f => f.screen !== 'player', x: 100, y: 48, size: 28, width: 82, align: 'left', bold: true, color: COLOR.coral, initial: 'TUBE' });
        label('brandTag', { show: f => f.screen !== 'player', x: 26, y: 76, size: 17, width: 190, align: 'left', color: COLOR.text3, initial: 'WATCH ANYTHING' });
        const tabs = [
            { id: 'home', title: 'Home', y: 128, icon: 'home' },
            { id: 'trending', title: 'Trending', y: 208, icon: 'trending' },
            { id: 'music', title: 'Music', y: 288, icon: 'note' },
            { id: 'search', title: 'Search', y: 368, icon: 'search' },
            { id: 'library', title: 'Library', y: 448, icon: 'library' }
        ];
        tabs.forEach(tab => {
            button('tab_' + tab.id, { x: 16, y: tab.y, w: 190, h: 68, show: f => f.screen !== 'voice' && f.screen !== 'player',
                action: call('nav', tab.id), look: f => ({ style: 'nav', icon: tab.icon, selected: f.tab === tab.id }) });
            label('tab_' + tab.id + 'Text', { x: 80, y: tab.y + 34, size: 28, width: 116, align: 'left', initial: tab.title, owner: 'tab_' + tab.id,
                show: f => f.screen !== 'voice' && f.screen !== 'player', fill: f => f.tab === tab.id ? COLOR.text : COLOR.text2, weight: f => f.tab === tab.id });
        });
        button('close', { x: 16, y: 616, w: 190, h: 68, show: f => f.screen !== 'voice' && f.screen !== 'player',
            action: call('close'), look: () => ({ style: 'outline', icon: 'close' }) });
        label('closeText', { x: 80, y: 650, size: 28, width: 116, align: 'left', initial: 'Close', owner: 'close', color: COLOR.text2, show: f => f.screen !== 'voice' && f.screen !== 'player' });        // Content header and back.
        button('back', { x: LEFT, y: 18, w: 112, h: 56, show: f => f.back, action: call('back'), look: () => ({ style: 'secondary', icon: 'back' }) });
        label('backText', { x: LEFT + 68, y: 46, size: 24, width: 80, align: 'left', initial: 'Back', owner: 'back', color: COLOR.text2, show: f => f.back });
        label('screenTitle', { x: LEFT, y: 46, size: 40, width: 620, align: 'left', bold: true, show: f => f.showTitle, text: f => f.title });
        label('screenSub', { x: LEFT, y: 82, size: 23, width: 620, align: 'left', color: COLOR.text2, show: f => f.showTitle && !!f.sub, text: f => f.sub });

        // Home shelves and cards.
        for (let s = 0; s < 2; s++) {
            const shelf = (f) => f.shelves[s];
            label('shelfTitle' + s, { x: LEFT, y: SHELF_TOP[s] + 20, size: 30, width: 560, align: 'left', bold: true,
                show: f => f.homeLike && !!shelf(f), text: f => shelf(f) ? shelf(f).title : '', place: f => ({ x: LEFT, y: f.shelfTops[s] + 20 }) });
            label('shelfSub' + s, { x: LEFT + 430, y: SHELF_TOP[s] + 22, size: 19, width: 140, align: 'right', color: COLOR.text3,
                show: f => f.homeLike && !!shelf(f), text: f => shelf(f) ? shelf(f).page : '', place: f => ({ x: LEFT + 430, y: f.shelfTops[s] + 22 }) });
            button('shelfPrev' + s, { x: 940, y: SHELF_TOP[s] + 4, w: 52, h: 46, show: f => f.homeLike && !!shelf(f) && shelf(f).pages > 1,
                enabled: f => shelf(f) && shelf(f).offset > 0, action: call('shelfPage', s, -1), look: () => ({ style: 'secondary', icon: 'back' }),
                place: f => ({ x: 940, y: f.shelfTops[s] + 4 }) });
            button('shelfNext' + s, { x: 998, y: SHELF_TOP[s] + 4, w: 52, h: 46, show: f => f.homeLike && !!shelf(f) && shelf(f).pages > 1,
                enabled: f => shelf(f) && shelf(f).offset + 4 < shelf(f).row.items.length, action: call('shelfPage', s, 1), look: () => ({ style: 'secondary', icon: 'chevron' }),
                place: f => ({ x: 998, y: f.shelfTops[s] + 4 }) });
            button('shelfAll' + s, { x: 1060, y: SHELF_TOP[s] + 4, w: 148, h: 46, show: f => f.homeLike && !!shelf(f),
                action: call('shelfAll', s), look: () => ({ style: 'secondary' }), place: f => ({ x: 1060, y: f.shelfTops[s] + 4 }) });
            label('shelfAllText' + s, { x: 1134, y: SHELF_TOP[s] + 27, size: 21, width: 132, initial: 'See all', owner: 'shelfAll' + s,
                place: f => ({ x: 1134, y: f.shelfTops[s] + 27 }) });
            for (let t = 0; t < 4; t++) {
                const id = 'card' + s + '_' + t, card = (f) => f.shelves[s] && f.shelves[s].cards[t];
                button(id, { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 54, w: CARD_W, h: 236, show: f => f.homeLike && !!card(f),
                    action: call('card', s, t), look: f => ({ style: 'card' }),
                    place: f => ({ x: LEFT + t * CARD_PITCH, y: f.shelfTops[s] + 54 }) });
                label(id + 'Title1', { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 208, size: 23, width: CARD_W, align: 'left', bold: true,
                    owner: id, show: f => f.homeLike && !!card(f), text: f => card(f).line1,
                    place: f => ({ x: LEFT + t * CARD_PITCH, y: f.shelfTops[s] + 208 }) });
                label(id + 'Title2', { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 234, size: 23, width: CARD_W, align: 'left', bold: true,
                    owner: id, show: f => f.homeLike && !!card(f) && !!card(f).line2, text: f => card(f).line2,
                    place: f => ({ x: LEFT + t * CARD_PITCH, y: f.shelfTops[s] + 234 }) });
                label(id + 'Sub', { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 264, size: 18, width: CARD_W, align: 'left', color: COLOR.text3,
                    owner: id, show: f => f.homeLike && !!card(f), text: f => card(f).sub,
                    place: f => ({ x: LEFT + t * CARD_PITCH, y: f.shelfTops[s] + 264 }) });
                label(id + 'Dur', { x: LEFT + t * CARD_PITCH + CARD_W - 8, y: SHELF_TOP[s] + 54 + CARD_H - 18, size: 17, width: 70, align: 'right',
                    color: 0xFFFFFF, owner: id, show: f => f.homeLike && !!card(f) && !!card(f).duration, text: f => card(f).duration,
                    place: f => ({ x: LEFT + t * CARD_PITCH + CARD_W - 8, y: f.shelfTops[s] + 54 + CARD_H - 18 }) });
            }
        }
        button('homeUp', { x: 1154, y: 18, w: 46, h: 46, show: f => f.homeLike, enabled: f => f.homeUp,
            action: call('homePage', -1), look: () => ({ style: 'secondary', icon: 'up' }) });
        button('homeDown', { x: 1208, y: 18, w: 46, h: 46, show: f => f.homeLike, enabled: f => f.homeDown,
            action: call('homePage', 1), look: () => ({ style: 'secondary', icon: 'down' }) });
        label('homePage', { x: 1148, y: 82, size: 18, width: 106, align: 'right', color: COLOR.text3, show: f => f.homeLike, text: f => f.homePage });        label('musicTitle', { x: LEFT, y: 48, size: 38, width: 500, align: 'left', bold: true, show: f => f.screen === 'music', initial: 'Music' });
        label('musicSub', { x: LEFT, y: 82, size: 21, width: 500, align: 'left', color: COLOR.text2, show: f => f.screen === 'music', initial: 'Songs, artists and moods' });
        button('musicSearch', { x: 980, y: 18, w: 170, h: 54, show: f => f.screen === 'music', action: call('musicSearchOpen'),
            look: () => ({ style: 'secondary', icon: 'search', iconLeft: true }) });
        label('musicSearchText', { x: 1065, y: 45, size: 21, width: 150, owner: 'musicSearch', initial: 'Search music' });


        // Search keyboard.
        label('searchQuery', { x: 278, y: 56, size: 32, width: 830, align: 'left', show: f => f.screen === 'search',
            text: f => f.query || (f.searchMode === 'music' ? 'Search music, artists, songs' : 'Search JiboTube'), fill: f => f.query ? COLOR.text : COLOR.text3 });
        button('searchClear', { x: 1112, y: 24, w: 58, h: 64, show: f => f.screen === 'search' && !!f.query, action: call('key', 'clear'),
            look: () => ({ style: 'key', icon: 'close' }) });
        button('searchVoice', { x: 1178, y: 24, w: 66, h: 64, show: f => f.screen === 'search', action: call('voice'),
            look: () => ({ style: 'key', icon: 'mic' }) });
        for (let i = 0; i < 4; i++) {
            button('recent' + i, { x: LEFT + i * 254, y: 106, w: 242, h: 50, show: f => f.screen === 'search' && !!f.recent[i],
                action: () => this.actions.recent(i), look: () => ({ style: 'chip' }) });
            label('recent' + i + 'Text', { x: LEFT + i * 254 + 121, y: 131, size: 20, width: 226, owner: 'recent' + i,
                show: f => f.screen === 'search' && !!f.recent[i], text: f => f.recent[i] });
        }
        const rowStart = [276, 320, 408];
        LETTERS.forEach((letters, r) => letters.split('').forEach((letter, c) => {
            const x = rowStart[r] + c * (KEYS.w + KEYS.gap), y = KEYS.y[r];
            button('key' + r + '_' + c, { x: x, y: y, w: KEYS.w, h: KEYS.h, show: f => f.screen === 'search',
                action: () => this.actions.key((this.state.symbols ? SYMBOLS : LETTERS)[r][c]), look: () => ({ style: 'key' }) });
            label('key' + r + '_' + c + 'Text', { x: x + KEYS.w / 2, y: y + 36, size: 30, width: KEYS.w - 8, owner: 'key' + r + '_' + c,
                text: f => (f.state.symbols ? SYMBOLS : LETTERS)[r][c].toUpperCase() });
        }));
        const special = (id, x, y, w, title, action, style, icon) => {
            button(id, { x: x, y: y, w: w, h: 66, show: f => f.screen === 'search', action: action,
                look: f => ({ style: style || 'keyAlt', icon: icon || '', iconLeft: style === 'primary', selected: id === 'keyGo' && !!f.query }) });
            if (title) label(id + 'Text', { x: x + w / 2, y: y + 33, size: 24, width: w - 12, initial: title, owner: id,
                bold: id === 'keyGo', color: id === 'keyGo' ? COLOR.onAccent : COLOR.text,
                text: id === 'keySymbols' ? (f => f.state.symbols ? 'ABC' : '123') : undefined });
        };
        special('keySymbols', LEFT, SPECIAL_Y, 100, '123', call('key', 'symbols'));
        special('keySpace', LEFT + 112, SPECIAL_Y, 420, 'Space', call('key', 'space'));
        special('keyBack', LEFT + 544, SPECIAL_Y, 110, '', call('key', 'backspace'), 'keyAlt', 'backspace');
        special('keyVoice2', LEFT + 666, SPECIAL_Y, 88, '', call('voice'), 'keyAlt', 'mic');
        special('keyGo', LEFT + 766, SPECIAL_Y, W - 766, 'Search', call('search'), 'primary', 'search');
        button('modeAll', { x: LEFT, y: 520, w: 150, h: 46, show: f => f.screen === 'search', action: call('setSearchMode', 'all'),
            look: f => ({ style: 'chip', selected: f.searchMode !== 'music' }) });
        label('modeAllText', { x: LEFT + 75, y: 543, size: 21, width: 130, owner: 'modeAll', initial: 'All',
            fill: f => f.searchMode !== 'music' ? COLOR.text : COLOR.text2 });
        button('modeMusic', { x: LEFT + 162, y: 520, w: 160, h: 46, show: f => f.screen === 'search', action: call('setSearchMode', 'music'),
            look: f => ({ style: 'chip', selected: f.searchMode === 'music' }) });
        label('modeMusicText', { x: LEFT + 242, y: 543, size: 21, width: 140, owner: 'modeMusic', initial: 'Music',
            fill: f => f.searchMode === 'music' ? COLOR.text : COLOR.text2 });
        label('searchTip', { x: LEFT + 350, y: 543, size: 18, width: 650, align: 'left', color: COLOR.text3, show: f => f.screen === 'search',
            text: f => f.searchMode === 'music' ? 'Searching music only — tap All for everything.' : 'Tip: tap the mic and say what you want to watch.' });

        // Voice.
        button('voiceCancel', { x: 0, y: 0, w: 1280, h: 720, show: f => f.screen === 'voice', action: call('cancelVoice'), look: () => ({ style: 'none' }) });
        label('voiceTitle', { x: 640, y: 356, size: 44, width: 700, bold: true, show: f => f.screen === 'voice', initial: 'Listening…' });
        label('voiceSub', { x: 640, y: 404, size: 26, width: 760, color: COLOR.text2, show: f => f.screen === 'voice',
            text: f => f.voiceText || 'Say what you want to watch' });
        label('voiceHint', { x: 640, y: 640, size: 21, width: 700, color: COLOR.text3, show: f => f.screen === 'voice', initial: 'Tap anywhere to cancel' });

        // Results.
        label('resultsTitle', { x: LEFT + 140, y: 46, size: 38, width: 580, align: 'left', bold: true, show: f => f.screen === 'results', text: f => f.resultsTitle });
        label('resultsSub', { x: LEFT + 140, y: 82, size: 22, width: 580, align: 'left', color: COLOR.text2, show: f => f.screen === 'results', text: f => f.resultsSub });
        button('resPrev', { x: 1090, y: 18, w: 52, h: 52, show: f => f.screen === 'results', enabled: f => f.resultsPage > 0,
            action: call('page', -1), look: () => ({ style: 'secondary', icon: 'back' }) });
        button('resNext', { x: 1206, y: 18, w: 52, h: 52, show: f => f.screen === 'results', enabled: f => f.resultsHasNext,
            action: call('page', 1), look: () => ({ style: 'secondary', icon: 'chevron' }) });
        label('resPage', { x: 1146, y: 44, size: 20, width: 58, color: COLOR.text3, show: f => f.screen === 'results', text: f => f.resultsPageLabel });
        for (let i = 0; i < 4; i++) {
            const id = 'result' + i, row = (f) => f.results[i];
            button(id, { x: LEFT, y: 110 + i * RESULT_PITCH, w: W, h: ROW_H, show: f => f.screen === 'results' && !!row(f),
                action: call('result', i), look: () => ({ style: 'row' }) });
            label(id + 'Title', { x: LEFT + 228, y: 110 + i * RESULT_PITCH + 30, size: 27, width: W - 250, align: 'left', bold: true, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).title });
            label(id + 'Sub', { x: LEFT + 228, y: 110 + i * RESULT_PITCH + 64, size: 21, width: W - 250, align: 'left', color: COLOR.text2, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).channel });
            label(id + 'Meta', { x: LEFT + 228, y: 110 + i * RESULT_PITCH + 94, size: 19, width: W - 250, align: 'left', color: COLOR.text3, owner: id,
                show: f => f.screen === 'results' && !!row(f), text: f => row(f).meta });
            label(id + 'Dur', { x: LEFT + 208, y: 110 + i * RESULT_PITCH + 96, size: 17, width: 78, align: 'right', color: 0xFFFFFF, owner: id,
                show: f => f.screen === 'results' && !!row(f) && !!row(f).duration, text: f => row(f).duration });
        }
        label('resultsEmpty', { x: MID, y: 340, size: 30, width: 700, color: COLOR.text2, show: f => f.screen === 'results' && !f.results.length && !f.loading,
            text: f => f.emptyText || 'Nothing found. Try another search.' });

        // Details.
        button('dHeroPlay', { x: LEFT, y: 92, w: 420, h: 236, show: f => f.screen === 'details', action: call('play'),
            look: () => ({ style: 'none' }) });
        label('dKind', { x: 264, y: 112, size: 18, width: 120, align: 'left', bold: true, color: 0xFFFFFF,
            show: f => f.screen === 'details' && f.detail && f.detail.music, initial: 'MUSIC' });
        label('dTitle1', { x: 700, y: 116, size: 32, width: 556, align: 'left', bold: true, show: f => f.screen === 'details', text: f => f.detail ? f.detail.title1 : '' });
        label('dTitle2', { x: 700, y: 158, size: 32, width: 556, align: 'left', bold: true, show: f => f.screen === 'details' && f.detail && !!f.detail.title2,
            text: f => f.detail ? f.detail.title2 : '' });
        label('dChannel', { x: 700, y: 198, size: 23, width: 556, align: 'left', color: COLOR.accent, show: f => f.screen === 'details', text: f => f.detail ? f.detail.channel : '' });
        label('dMeta', { x: 700, y: 230, size: 21, width: 556, align: 'left', color: COLOR.text2, show: f => f.screen === 'details', text: f => f.detail ? f.detail.meta : '' });
        label('dLikes', { x: 700, y: 260, size: 19, width: 556, align: 'left', color: COLOR.text3, show: f => f.screen === 'details', text: f => f.detail ? f.detail.likes : '' });
        button('dPlay', { x: 700, y: 290, w: 200, h: 68, show: f => f.screen === 'details', action: call('play'), look: () => ({ style: 'primary', icon: 'play', iconLeft: true }) });
        label('dPlayText', { x: 800, y: 324, size: 25, width: 180, bold: true, color: COLOR.onAccent, owner: 'dPlay', text: f => f.detail && f.detail.busy ? 'Preparing' : f.detail && f.detail.error ? 'Retry' : 'Play' });
        button('dLike', { x: 920, y: 290, w: 170, h: 68, show: f => f.screen === 'details', action: call('like'),
            look: f => ({ style: 'toggle', icon: 'heart', iconLeft: true, selected: f.detail && f.detail.liked }) });
        label('dLikeText', { x: 1012, y: 324, size: 23, width: 150, owner: 'dLike', text: f => f.detail && f.detail.liked ? 'Liked' : 'Like',
            fill: f => f.detail && f.detail.liked ? COLOR.coral : COLOR.text });
        label('dSb', { x: 700, y: 378, size: 20, width: 556, align: 'left', color: COLOR.sponsor, show: f => f.screen === 'details', text: f => f.detail ? f.detail.sponsorText : '' });
        label('dStatus', { x: 700, y: 404, size: 19, width: 556, align: 'left', show: f => f.screen === 'details',
            text: f => f.detail ? (f.detail.errorText || f.detail.statusText) : '',
            fill: f => f.detail && f.detail.error ? COLOR.danger : COLOR.text3 });
        for (let i = 0; i < 4; i++) {
            label('dDesc' + i, { x: LEFT, y: 366 + i * 30, size: 21, width: 420, align: 'left', color: COLOR.text2,
                show: f => f.screen === 'details' && !!f.detail && !!f.detail.desc[i], text: f => f.detail ? f.detail.desc[i] : '' });
        }
        label('dRelTitle', { x: 700, y: 458, size: 26, width: 300, align: 'left', bold: true, show: f => f.screen === 'details', initial: 'Up next' });
        button('dRelPrev', { x: 1146, y: 430, w: 44, h: 44, show: f => f.screen === 'details' && f.detail && f.detail.relPages > 1,
            enabled: f => f.detail && f.detail.relPage > 0, action: call('relatedPage', -1), look: () => ({ style: 'secondary', icon: 'up' }) });
        button('dRelNext', { x: 1198, y: 430, w: 44, h: 44, show: f => f.screen === 'details' && f.detail && f.detail.relPages > 1,
            enabled: f => f.detail && f.detail.relPage + 1 < f.detail.relPages, action: call('relatedPage', 1), look: () => ({ style: 'secondary', icon: 'down' }) });
        for (let i = 0; i < 3; i++) {
            const id = 'rel' + i, rel = (f) => f.detail && f.detail.related[i];
            button(id, { x: 700, y: 480 + i * 72, w: 556, h: 64, show: f => f.screen === 'details' && !!rel(f),
                action: call('related', i), look: () => ({ style: 'row' }) });
            label(id + 'Title', { x: 840, y: 480 + i * 72 + 24, size: 20, width: 400, align: 'left', bold: true, owner: id,
                show: f => f.screen === 'details' && !!rel(f), text: f => rel(f).title });
            label(id + 'Sub', { x: 840, y: 480 + i * 72 + 46, size: 16, width: 400, align: 'left', color: COLOR.text3, owner: id,
                show: f => f.screen === 'details' && !!rel(f), text: f => rel(f).sub });
        }
        label('dRelEmpty', { x: 720, y: 520, size: 22, width: 520, align: 'left', color: COLOR.text3,
            show: f => f.screen === 'details' && f.detail && !f.detail.related.length, initial: 'No related videos yet.' });

        // Library.
        for (let s = 0; s < 2; s++) {
            const shelf = (f) => f.library[s];
            label('libTitle' + s, { x: LEFT, y: SHELF_TOP[s] + 20, size: 30, width: 600, align: 'left', bold: true,
                show: f => f.screen === 'library' && !!shelf(f), text: f => shelf(f) ? shelf(f).title : '' });
            for (let t = 0; t < 4; t++) {
                const id = 'libCard' + s + '_' + t, card = (f) => f.library[s] && f.library[s].cards[t];
                button(id, { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 54, w: CARD_W, h: 190, show: f => f.screen === 'library' && !!card(f),
                    action: call('libCard', s, t), look: () => ({ style: 'card' }) });
                label(id + 'Title1', { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 208, size: 22, width: CARD_W, align: 'left', bold: true, owner: id,
                    show: f => f.screen === 'library' && !!card(f), text: f => card(f).line1 });
                label(id + 'Sub', { x: LEFT + t * CARD_PITCH, y: SHELF_TOP[s] + 238, size: 17, width: CARD_W, align: 'left', color: COLOR.text3, owner: id,
                    show: f => f.screen === 'library' && !!card(f), text: f => card(f).sub });
                label(id + 'Dur', { x: LEFT + t * CARD_PITCH + CARD_W - 8, y: SHELF_TOP[s] + 54 + CARD_H - 18, size: 17, width: 70, align: 'right',
                    color: 0xFFFFFF, owner: id, show: f => f.screen === 'library' && !!card(f) && !!card(f).duration, text: f => card(f).duration });
            }
        }
        button('libClear', { x: 1120, y: 18, w: 136, h: 52, show: f => f.screen === 'library' && f.historyCount > 0,
            action: call('clearHistory'), look: f => ({ style: f.libConfirm ? 'warning' : 'secondary' }) });
        label('libClearText', { x: 1188, y: 44, size: 19, width: 120, owner: 'libClear', text: f => f.libConfirm ? 'Tap to clear' : 'Clear history',
            color: f => f.libConfirm ? 0x2A0B07 : COLOR.text });
        label('libEmpty', { x: MID, y: 330, size: 28, width: 700, color: COLOR.text2,
            show: f => f.screen === 'library' && !f.loading && !f.library.some(shelf => shelf && shelf.cards.length),
            initial: 'Watch or like something and it will appear here.' });
        label('libLikedEmpty', { x: LEFT, y: SHELF_TOP[1] + 76, size: 22, width: 620, align: 'left', color: COLOR.text3,
            show: f => f.screen === 'library' && f.library[1] && !f.library[1].cards.length, initial: 'Like a video and it will appear here.' });

        // Player controls (the visible picture is drawn as video layers over these).
        const playerShown = f => f.screen === 'player' && f.player && (f.player.controlsVisible || f.player.settingsOpen || f.player.ended);
        const settingsShown = f => f.screen === 'player' && f.player && f.player.settingsOpen;
        button('pScreenTap', { x: 0, y: 0, w: 1280, h: 720, show: f => f.screen === 'player' && f.player && !f.player.settingsOpen && !f.player.ended,
            action: call('screenTap'), look: () => ({ style: 'none' }) });
        button('pBack', { x: 20, y: 16, w: 92, h: 60, show: playerShown, action: call('playerBack'), look: () => ({ style: 'none' }) });
        button('pPlay', { x: 540, y: 260, w: 200, h: 200, show: playerShown, action: call('togglePlay'), look: () => ({ style: 'none' }) });
        button('pBack10', { x: 34, y: 620, w: 84, h: 76, show: playerShown, action: call('seek', -10), look: () => ({ style: 'none' }) });
        button('pToggle', { x: 132, y: 616, w: 92, h: 84, show: playerShown, action: call('togglePlay'), look: () => ({ style: 'none' }) });
        button('pFwd10', { x: 238, y: 620, w: 84, h: 76, show: playerShown, action: call('seek', 10), look: () => ({ style: 'none' }) });
        button('pNext', { x: 1138, y: 616, w: 92, h: 84, show: playerShown, action: call('next'), look: () => ({ style: 'none' }) });
        button('pSettings', { x: 900, y: 552, w: 72, h: 64, show: playerShown, action: call('toggleSettings'), look: () => ({ style: 'none' }) });
        button('pVolDown', { x: 996, y: 558, w: 60, h: 56, show: playerShown, action: call('volumeDown'), look: () => ({ style: 'none' }) });
        button('pVolUp', { x: 1166, y: 558, w: 60, h: 56, show: playerShown, action: call('volumeUp'), look: () => ({ style: 'none' }) });
        button('pReplay', { x: 560, y: 370, w: 160, h: 64, show: f => f.screen === 'player' && f.player && f.player.ended, action: call('replay'),
            look: () => ({ style: 'primary', icon: 'play', iconLeft: true }) });
        label('pReplayText', { x: 640, y: 402, size: 22, width: 140, bold: true, color: COLOR.onAccent, owner: 'pReplay',
            show: f => f.screen === 'player' && f.player && f.player.ended, initial: 'Replay' });
        button('pCancel', { x: 760, y: 370, w: 170, h: 64, show: f => f.screen === 'player' && f.player && f.player.ended, action: call('playerBack'),
            look: () => ({ style: 'secondary', icon: 'back', iconLeft: true }) });
        label('pCancelText', { x: 845, y: 402, size: 22, width: 150, owner: 'pCancel',
            show: f => f.screen === 'player' && f.player && f.player.ended, initial: 'Back' });
        for (let i = 0; i < 12; i++) {
            button('pSeek' + i, { x: 332 + i * 66, y: 612, w: 66, h: 84, show: playerShown, action: call('seekTo', (i + 0.5) / 12),
                look: () => ({ style: 'none' }) });
        }
        // Settings panel (drawn as a video layer; these are transparent hit areas).
        button('pSetPanel', { x: 300, y: 150, w: 680, h: 420, show: settingsShown, action: call('closeSettings'), look: () => ({ style: 'none' }) });
        button('pCapOff', { x: 620, y: 215, w: 120, h: 46, show: settingsShown, action: call('toggleCaptions', false), look: () => ({ style: 'none' }) });
        button('pCapOn', { x: 752, y: 215, w: 120, h: 46, show: settingsShown, action: call('toggleCaptions', true), look: () => ({ style: 'none' }) });
        button('pLoopOff', { x: 620, y: 285, w: 120, h: 46, show: settingsShown, action: call('setLoop', false), look: () => ({ style: 'none' }) });
        button('pLoopOn', { x: 752, y: 285, w: 120, h: 46, show: settingsShown, action: call('setLoop', true), look: () => ({ style: 'none' }) });
        button('pAutoOff', { x: 620, y: 355, w: 120, h: 46, show: settingsShown, action: call('setAutoplay', false), look: () => ({ style: 'none' }) });
        button('pAutoOn', { x: 752, y: 355, w: 120, h: 46, show: settingsShown, action: call('setAutoplay', true), look: () => ({ style: 'none' }) });
        button('pSetClose', { x: 540, y: 490, w: 200, h: 64, show: settingsShown, action: call('closeSettings'), look: () => ({ style: 'none' }) });
        label('playerStatus', { x: 640, y: 330, size: 28, width: 700, show: f => f.screen === 'player' && f.player && f.player.starting && !f.player.session,
            text: f => f.player ? f.player.statusText : 'Starting…', color: COLOR.text2 });
        label('pEndTitle', { x: 640, y: 250, size: 20, width: 560, color: COLOR.accent, bold: true, show: f => f.screen === 'player' && f.player && f.player.ended, initial: 'UP NEXT' });
        label('pEndNext', { x: 640, y: 296, size: 30, width: 560, bold: true, show: f => f.screen === 'player' && f.player && f.player.ended,
            text: f => f.player ? shorten(f.player.nextTitle || 'Pick another video', 54) : '' });
        label('pEndCount', { x: 640, y: 332, size: 19, width: 560, color: COLOR.text2, show: f => f.screen === 'player' && f.player && f.player.ended,
            text: f => f.player ? (f.player.autoplayIn > 0 ? 'Playing in ' + f.player.autoplayIn + 's' : 'Autoplay is off') : '' });

        // Status and toast.
        label('statusTitle', { x: MID, y: 300, size: 34, width: 800, bold: true, show: f => !!f.status, text: f => f.status ? f.status.title : '' });
        label('statusBody', { x: MID, y: 346, size: 25, width: 800, color: COLOR.text2, show: f => !!f.status && !!f.status.body,
            text: f => f.status ? f.status.body : '' });
        button('statusAction', { x: MID - 130, y: 400, w: 260, h: 66, show: f => !!f.status && !!f.status.action,
            action: call('statusAction'), look: () => ({ style: 'primary', icon: 'play', iconLeft: true }) });
        label('statusActionText', { x: MID, y: 433, size: 25, width: 230, bold: true, color: COLOR.onAccent, owner: 'statusAction',
            text: f => f.status ? f.status.action : '' });
        label('toast', { x: MID, y: 660, size: 22, width: 900, show: f => !!f.toast, text: f => f.toast });

        // Art slots.
        for (let s = 0; s < 2; s++) for (let t = 0; t < 4; t++) {
            this.slot('cardArt' + s + '_' + t, { owner: 'card' + s + '_' + t, x: 0, y: 0, w: CARD_W, h: CARD_H, radius: 14, pill: true,
                show: f => f.homeLike && !!(f.shelves[s] && f.shelves[s].cards[t]),
                url: f => f.shelves[s] && f.shelves[s].cards[t] ? f.shelves[s].cards[t].thumbUrl : '',
                pillData: f => f.shelves[s] && f.shelves[s].cards[t] ? { duration: f.shelves[s].cards[t].duration, progress: f.shelves[s].cards[t].progress } : null });
            this.slot('libArt' + s + '_' + t, { owner: 'libCard' + s + '_' + t, x: 0, y: 0, w: CARD_W, h: CARD_H, radius: 14, pill: true,
                show: f => f.screen === 'library' && !!(f.library[s] && f.library[s].cards[t]),
                url: f => f.library[s] && f.library[s].cards[t] ? f.library[s].cards[t].thumbUrl : '',
                pillData: f => f.library[s] && f.library[s].cards[t] ? { duration: f.library[s].cards[t].duration, progress: f.library[s].cards[t].progress } : null });
        }
        for (let i = 0; i < 4; i++) this.slot('resultArt' + i, { owner: 'result' + i, x: 8, y: 8, w: 200, h: 112, radius: 10, pill: true,
            show: f => f.screen === 'results' && !!f.results[i], url: f => f.results[i] ? f.results[i].thumbUrl : '',
            pillData: f => f.results[i] ? { duration: f.results[i].duration, progress: 0 } : null });
        this.slot('heroArt', { owner: 'dHeroPlay', x: 0, y: 0, w: 420, h: 236, radius: 16, overlay: 'hero',
            show: f => f.screen === 'details' && !!f.detail, url: f => f.detail ? f.detail.thumbUrl : '' });
        for (let i = 0; i < 3; i++) this.slot('relArt' + i, { owner: 'rel' + i, x: 8, y: 4, w: 124, h: 56, radius: 8,
            show: f => f.screen === 'details' && !!(f.detail && f.detail.related[i]), url: f => f.detail && f.detail.related[i] ? f.detail.related[i].thumbUrl : '' });

        return { viewConfig: { type: 'View', id: 'be-jibotube', category: 'gui', ignoreSwipeDown: true, transitionStageOnly: true },
            componentConfigs: this.groupConfigs.base.slice() };
    }

    slot(id, spec) { spec = Object.assign({ id: id }, spec); spec.group = this.groupOfId(spec.owner); this.slots[id] = spec; }

    groupOfId(id) {
        if (/^(brand|tab_|close|sbBadge|railStatus|back|screenTitle|screenSub|status|toast)/.test(id)) return 'base';
        if (/^p[A-Z]/.test(id) || /^player/.test(id)) return 'player';
        if (/^(d[A-Z]|dDesc|dRel|rel|heroArt)/.test(id)) return 'details';
        if (/^lib/.test(id)) return 'library';
        if (/^(results|res|result)/.test(id)) return 'results';
        if (/^voice/.test(id)) return 'voice';
        if (/^(search|recent|key)/.test(id)) return 'search';
        if (/^(shelf|card|home)/.test(id)) return 'home';
        return 'base';
    }

    compute(state) {
        const f = { state: state, screen: state.screen, tab: state.tab, loading: state.loading, query: state.query || '',
            recent: (state.recentSearches || []).slice(0, 4), back: false, showTitle: false, title: '', sub: '',
            shelves: [], library: [], cards: [], results: [], resultPage: state.resultsPage || 0,
            homeLike: state.screen === 'home' || state.screen === 'music', searchMode: state.searchMode || 'all',
            homeUp: false, homeDown: false, homePage: '', shelfTops: SHELF_TOP.slice(),
            toast: state.toast && Date.now() - state.toastAt < 4200 ? state.toast : '',
            status: state.status, player: state.player, detail: null,
            historyCount: state.library ? state.library.history.length : 0, libConfirm: !!state.libConfirm,
            railStatus: state.railStatus || '' };
        if (f.homeLike && (state.home || state.musicHome)) {
            const source = f.screen === 'music' ? state.musicHome : state.home;
            const rows = source ? (source.rows || []) : [];
            const top = Math.max(0, Math.min(f.screen === 'music' ? (state.musicHomeTop || 0) : (state.homeTop || 0), Math.max(0, rows.length - 2)));
            f.homeUp = top > 0; f.homeDown = top + 2 < rows.length;
            f.homePage = rows.length ? (top + 1) + '–' + Math.min(rows.length, top + 2) + ' / ' + rows.length : '';
            for (let s = 0; s < 2; s++) {
                const row = rows[top + s];
                if (!row) { f.shelves.push(null); f.shelfTops[s] = SHELF_TOP[s]; continue; }
                const offset = Math.max(0, Math.min(state.shelfOffsets[row.id] || 0, Math.max(0, row.items.length - 1)));
                const items = row.items.slice(offset, offset + 4);
                const pages = Math.max(1, Math.ceil(row.items.length / 4));
                f.shelves.push({ title: row.title, row: row, offset: offset, pages: pages,
                    page: pages > 1 ? (Math.floor(offset / 4) + 1) + '/' + pages : '', cards: items.map(item => this.card(item)) });
                f.shelfTops[s] = SHELF_TOP[s];
            }
            f.showTitle = false;
        } else if (f.screen === 'search') {
            f.back = false; f.showTitle = false;
        } else if (f.screen === 'results') {
            const result = state.results || { title: 'Results', items: [] };
            const page = f.resultPage = f.resultsPage = Math.max(0, state.resultsPage || 0);
            const items = result.items.slice(page * 4, page * 4 + 4);
            f.results = items.map(item => this.row(item));
            f.resultsTitle = result.title || 'Results';
            f.resultsSub = result.items.length + (result.music ? (result.items.length === 1 ? ' track' : ' tracks') : (result.items.length === 1 ? ' video' : ' videos')) + (result.sub ? ' · ' + result.sub : '');
            f.resultsPageLabel = (page + 1) + '/' + Math.max(1, Math.ceil(result.items.length / 4));
            f.resultsHasNext = (page + 1) * 4 < result.items.length;
            f.back = !!result.back;
        } else if (f.screen === 'details' && state.details) {
            const d = state.details, v = d.video;
            const lines = splitTitle(v.title, 38);
            const job = state.prepare || d.prepared || {};
            const failed = !!(job && job.state === 'error');
            const errorText = failed ? (job.message || 'This video could not be prepared.') : '';
            const relPage = state.relatedPage || 0, related = (d.related || []);
            const relPages = Math.max(1, Math.ceil(related.length / 3));
            f.detail = {
                title1: lines[0], title2: lines[1], channel: v.channel || 'YouTube',
                meta: [views(v.views), ago(v.published), clock(job && job.cleanDuration || v.duration)].filter(Boolean).join(' · '),
                likes: v.likes ? (v.likes >= 1000 ? (v.likes / 1000).toFixed(1).replace(/\.0$/, '') + 'K likes' : v.likes + ' likes') : '',
                desc: wrap(v.description || 'No description.', 46, 4),
                liked: !!(state.liked), thumbUrl: state.thumbUrl,
                sponsorText: (d.sponsor && d.sponsor.segments && d.sponsor.segments.length) ?
                    'SPONSORBLOCK · ' + d.sponsor.segments.length + (d.sponsor.segments.length === 1 ? ' segment skipped' : ' segments skipped') : 'SPONSORBLOCK · nothing to skip',
                statusText: job && job.state === 'preparing' ? (job.detail || 'Preparing video…') : '',
                busy: !!(job && job.state === 'preparing'), job: job, error: failed, errorText: errorText,
                music: !!state.detailsMusic,
                related: related.slice(relPage * 3, relPage * 3 + 3).map(item => ({ title: shorten(item.title, 52), sub: shorten(item.channel || '', 40), thumbUrl: item.thumbUrl || '' })),
                relPage: relPage, relPages: relPages
            };
            f.back = true;
        } else if (f.screen === 'library' && state.library) {
            const library = state.library;
            const continueItems = library.history.filter(item => item.position > 0).slice(0, 8);
            const liked = library.likes.slice(0, 8);
            const shelves = [
                { title: 'Continue watching', items: continueItems },
                { title: 'Liked videos', items: liked }
            ];
            f.library = shelves.map(shelf => ({ title: shelf.title, cards: shelf.items.map(item => this.card(item)) }));
            f.bgKey = f.library.map(shelf => shelf.cards.map(card => card && card.id + ':' + card.duration).join(',')).join('|');
            f.showTitle = false;
        } else if (f.screen === 'player' && state.player) {
            f.showTitle = false;
        }
        if (f.screen === 'details') f.showTitle = false;
        if (f.screen === 'results') f.showTitle = false;
        if (state.loading && f.screen === 'loading') f.status = f.status || { title: 'Loading JiboTube', body: 'Finding something good…' };
        f.bgKey = (f.bgKey || '') + '|' + f.shelves.map(shelf => shelf ? shelf.cards.map(card => card && card.id + ':' + card.duration + ':' + Math.round((card.progress || 0) * 100)).join(',') : '').join('|');
        if (state.status) f.status = state.status;
        return f;
    }

    card(item) {
        if (!item) return null;
        const lines = splitTitle(item.title, 30);
        const sub = [item.channel || '', item.views ? views(item.views) : ''].filter(Boolean).join(' · ');
        return { id: item.id, title: item.title, channel: item.channel, line1: lines[0], line2: lines[1],
            sub: shorten(sub, 38), duration: item.duration ? clock(item.duration) : '', thumbUrl: item.thumbUrl || '',
            progress: item.progress || (item.duration && item.position ? Math.min(1, item.position / item.duration) : 0) };
    }
    row(item) {
        return { id: item.id, title: shorten(item.title, 52), channel: shorten(item.channel || '', 46),
            meta: [views(item.views), ago(item.published)].filter(Boolean).join(' · '),
            duration: item.duration ? clock(item.duration) : '', thumbUrl: item.thumbUrl || '' };
    }
    thumbOf(item) { return item && item.thumbUrl || ''; }

    available(control) { try { return !control.enabled || !!control.enabled(this.frame); } catch (_) { return false; } }
    visible(control) { try { return !control.show || !!control.show(this.frame); } catch (_) { return false; } }
    enabled(control) { return this.available(control); }
    press(id) {
        const control = this.byId[id];
        if (control && control.button && this.visible(control) && this.available(control) && this.actions.allowed()) control.action();
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
            component.display.addChild(shape); this.shapes[control.id] = shape;
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
        owner.display.addChild(holder); owner.display.addChild(mask);
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
        if (old !== 'base') this.detachSlots(old);
        if (old !== 'base') (this.groupConfigs[old] || []).forEach(config => {
            const component = this.view.getComponentById(config.id);
            if (component) {
                try { this.view.removeComponent(config.id); } catch (_) {}
                try { if (component.display && component.display.parent) component.display.parent.removeChild(component.display); } catch (_) {}
                try { component.destroy(); } catch (_) {}
            }
            delete this.shapes[config.id]; delete this.cache[config.id];
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
        ['toast', 'statusTitle', 'statusBody', 'statusAction', 'statusActionText'].forEach(id => {
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
        const limit = Math.max(16, Math.min(control.width, width || control.width) - 4);
        const key = (value || '') + '|' + limit + '|' + label.style.fontWeight;
        if (this.cache[control.id] === key) return;
        this.cache[control.id] = key;
        label.style.fontSize = control.size;
        const string = String(value || '');
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
                component.lockInput(!visible || !this.available(control));
                if (!visible) return;
                const rect = this.place(control, component, f);
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
        const look = control.look ? control.look(f) : { style: 'none' }, shape = this.shapes[control.id];
        if (!shape) return;
        const key = JSON.stringify([look, rect.w, rect.h]);
        if (shape.paintKey === key) return;
        shape.paintKey = key;
        const g = shape.clear(), w = rect.w, h = rect.h, s = look.style;
        if (s === 'none') return;
        if (s === 'nav') {
            if (look.selected) { draw.roundedRect(g, 0, 0, w, h, 18, COLOR.raised, 1); draw.roundedRect(g, 0, 10, 5, h - 20, 2, COLOR.accent, 1); }
            draw.icon(g, look.icon, 20, h / 2 - 18, 36, look.selected ? COLOR.text : COLOR.text2);
            return;
        }
        if (s === 'outline') {
            draw.roundedRect(g, 0, 0, w, h, 16, COLOR.surface, 1);
            draw.icon(g, look.icon, 20, h / 2 - 16, 32, COLOR.text2);
            return;
        }
        if (s === 'card') {
            draw.roundedRect(g, 0, 0, w, h, 16, COLOR.card, 1);
            return;
        }
        if (s === 'row') {
            draw.roundedRect(g, 0, 0, w, h, 12, COLOR.surface, 1);
            draw.roundedRect(g, 0, 8, 4, h - 16, 2, COLOR.line2, 1);
            return;
        }
        if (s === 'chip') {
            draw.roundedRect(g, 0, 0, w, h, 14, COLOR.raised, 1);
            return;
        }
        if (s === 'key' || s === 'keyAlt') {
            draw.roundedRect(g, 0, 0, w, h, 12, s === 'key' ? COLOR.raised : COLOR.surface, 1);
            if (look.icon) draw.icon(g, look.icon, w / 2 - 15, h / 2 - 15, 30, COLOR.text2);
            return;
        }
        if (s === 'primary') {
            draw.roundedRect(g, 0, 0, w, h, 14, look.selected === false ? COLOR.accentDark : COLOR.accent, 1);
            if (look.icon) draw.icon(g, look.icon, look.iconLeft ? 16 : w / 2 - 15, h / 2 - 15, 30, COLOR.onAccent);
            return;
        }
        if (s === 'secondary' || s === 'toggle') {
            draw.roundedRect(g, 0, 0, w, h, 12, COLOR.raised, 1);
            if (look.icon) draw.icon(g, look.icon, look.iconLeft ? 14 : w / 2 - 14, h / 2 - 14, 28, s === 'toggle' && look.selected ? COLOR.coral : COLOR.text);
            return;
        }
        if (s === 'warning') {
            draw.roundedRect(g, 0, 0, w, h, 12, COLOR.coral, 1);
            return;
        }
        if (s === 'disc') {
            draw.roundedRect(g, 0, 0, w, h, w / 2, COLOR.accent, 1);
            draw.icon(g, look.icon || 'play', w * 0.28, h * 0.28, w * 0.44, COLOR.onAccent);
            return;
        }
    }

    paintBackground(f) {
        const key = [f.screen, f.tab, f.loading, f.status ? f.status.title : '', f.player && f.player.starting, f.detail && f.detail.busy,
            f.libConfirm, f.bgKey || ''].join('|');
        if (this.background.paintKey === key) return;
        this.background.paintKey = key;
        const g = this.background.clear().lineStyle(0, 0, 0);
        // The player's controls show through holes in the video: plain black.
        if (f.screen === 'player') { g.beginFill(0x000000, 1).drawRect(0, 0, 1280, 720).endFill(); return; }
        g.beginFill(0x08181E, 1).drawRect(0, 0, 1280, 720).endFill();
        // A soft teal wash near the top, then the rail.
        for (let i = 0; i < 18; i++) {
            g.beginFill(COLOR.accent, 0.006 + i * 0.0022).drawRect(220, i * 12, 1060, 12).endFill();
        }
        g.beginFill(COLOR.rail, 1).drawRect(0, 0, 220, 720).endFill();
        g.beginFill(COLOR.line, 0.55).drawRect(220, 0, 2, 720).endFill();
        if (f.screen === 'search') {
            draw.roundedRect(g, LEFT, 18, W, 76, 16, COLOR.raised, 1);
            if (!f.query) draw.roundedRect(g, 278, 34, 3, 44, 1, COLOR.accent, 0.85);
        }
        if (f.screen === 'details' && f.detail) {
            draw.roundedRect(g, LEFT - 3, 89, 426, 242, 18, COLOR.line, 0.75);
        }
        if (f.screen === 'voice') {
            draw.roundedRect(g, 390, 90, 500, 580, 34, COLOR.surface, 0.72);
        }
        if (f.screen === 'player' && f.player && f.player.ended) {
            for (let i = 0; i < 30; i++) g.beginFill(0x020A0D, 0.018).drawRect(0, i * 24, 1280, 26).endFill();
            draw.roundedRect(g, 330, 200, 620, 300, 28, COLOR.surface, 0.96);
            draw.roundedRect(g, 330, 200, 620, 6, 3, COLOR.accent, 0.9);
        }
    }

    paintProgress(f) {
        const g = this.progress.clear().lineStyle(0, 0, 0);
        if (f.screen === 'voice') {
            const phase = Date.now() / 180;
            const bars = 9, base = 640 - (bars - 1) * 20;
            for (let i = 0; i < bars; i++) {
                const level = 0.25 + 0.75 * Math.abs(Math.sin(phase + i * 0.55));
                const height = 20 + level * 96;
                g.beginFill(COLOR.accent, 0.55 + level * 0.45).drawRect(base + i * 40 - 7, 500 - height / 2, 14, height).endFill();
            }
            g.beginFill(COLOR.accent, 1); draw.disc(g, 640, 220, 88); g.endFill();
            draw.icon(g, 'mic', 640 - 36, 220 - 36, 72, COLOR.onAccent);
        }
        if (f.screen === 'details' && f.detail && f.detail.job && f.detail.job.state === 'preparing') {
            const job = f.detail.job, progress = Math.max(0, Math.min(1, Number(job.progress) || 0));
            draw.roundedRect(g, 700, 424, 556, 8, 4, COLOR.line, 1);
            draw.roundedRect(g, 700, 424, Math.max(8, 556 * progress), 8, 4, COLOR.accent, 1);
        }
    }

    paintToast(f) {
        if (!this.toastBox) return;
        const g = this.toastBox.clear();
        if (!f.toast) return;
        const label = this.view.getComponentById('toast');
        const width = Math.min(920, (label && label.style ? this.PIXI.TextMetrics.measureText(label.text, label.style).width : 500) + 48);
        draw.roundedRect(g, MID - width / 2, 634, width, 52, 14, COLOR.raised, 0.96);
        draw.roundedRect(g, MID - width / 2, 634, 5, 52, 2, COLOR.accent, 1);
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
                    draw.roundedRect(slot.pillGraphics, slot.w - 70, slot.h - 30, 62, 24, 7, 0x000000, 0.72);
                    if (pill.progress > 0) {
                        slot.pillGraphics.beginFill(0x000000, 0.6).drawRect(0, slot.h - 4, slot.w, 4).endFill();
                        slot.pillGraphics.beginFill(COLOR.accent, 1).drawRect(0, slot.h - 4, slot.w * Math.min(1, pill.progress), 4).endFill();
                    }
                } } catch (_) {} }
            }
            if (!visible) { if (slot.sprite.visible) { slot.sprite.visible = false; slot.sprite.texture = this.PIXI.Texture.EMPTY; } return; }
            if (url) wanted.push(url);
            const texture = this.art && url ? this.art.texture(url) : null;
            if (texture) {
                const scale = Math.max(slot.w / Math.max(1, texture.width), slot.h / Math.max(1, texture.height));
                slot.sprite.texture = texture; slot.sprite.scale.x = scale; slot.sprite.scale.y = scale;
                slot.sprite.position.x = (slot.w - texture.width * scale) / 2; slot.sprite.position.y = (slot.h - texture.height * scale) / 2;
                slot.sprite.visible = true; slot.placeholder.visible = false;
                if (slot.overlayGraphics) {
                    slot.overlayGraphics.beginFill(0x000000, 0.28); slot.overlayGraphics.drawRect(0, 0, slot.w, slot.h); slot.overlayGraphics.endFill();
                    slot.overlayGraphics.beginFill(COLOR.accent, 0.95); draw.disc(slot.overlayGraphics, slot.w / 2, slot.h / 2, 38); slot.overlayGraphics.endFill();
                    draw.icon(slot.overlayGraphics, 'play', slot.w / 2 - 14, slot.h / 2 - 14, 28, COLOR.onAccent);
                }
            } else {
                if (slot.sprite.visible) { slot.sprite.visible = false; slot.sprite.texture = this.PIXI.Texture.EMPTY; }
                slot.placeholder.visible = true;
                if (slot.drawn !== 'empty') {
                    slot.drawn = 'empty';
                    const g = slot.placeholder.clear().lineStyle(0, 0, 0);
                    draw.roundedRect(g, 0, 0, slot.w, slot.h, slot.radius || 0, COLOR.raised, 1);
                    draw.icon(g, 'play', slot.w / 2 - 22, slot.h / 2 - 22, 44, COLOR.text3);
                }
                if (slot.overlayGraphics) {
                    slot.overlayGraphics.beginFill(COLOR.accent, 0.95); draw.disc(slot.overlayGraphics, slot.w / 2, slot.h / 2, 38); slot.overlayGraphics.endFill();
                    draw.icon(slot.overlayGraphics, 'play', slot.w / 2 - 14, slot.h / 2 - 14, 28, COLOR.onAccent);
                }
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
            if (control.button) out.push({ id: control.id, type: 'button', x: d.position.x, y: d.position.y, w: d.hitArea.width, h: d.hitArea.height });
            else out.push({ id: control.id, type: 'label', x: d.position.x, y: d.position.y, text: component.text, size: component.style.fontSize, align: control.align,
                width: component.text ? this.PIXI.TextMetrics.measureText(component.text, component.style).width : 0, limit: control.width });
        });
        return { screen: this.frame.screen, controls: out };
    }
}

module.exports = { UI: UI, LETTERS: LETTERS, SYMBOLS: SYMBOLS, COLOR: COLOR, clock: clock, views: views, ago: ago, splitTitle: splitTitle, wrap: wrap };
