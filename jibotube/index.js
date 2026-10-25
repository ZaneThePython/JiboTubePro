'use strict';

const jibo = require('jibo');
const diagnostics = require('./diagnostics');
const timers = require('timers');
const FACE_HELD_MS = 250;
const BeSkill = require('@be/be-framework').BeSkill;
const lifecycle = require('./touch-lifecycle');
const video = require('./video');
const ClientModule = require('./client');
const ServiceModule = require('./service');
const StoreModule = require('./store');
const UIModule = require('./ui');
const UI = UIModule.UI;
const Overlay = require('./overlay').Overlay;

const MAX_HOME_ROWS = 9;
const SESSION_LIMIT_MS = 4 * 60 * 60 * 1000;
function monotonic() { if (typeof process === 'undefined' || typeof process.hrtime !== 'function') return Date.now(); const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }
const MAX_STACK = 12;
const LIKE_SETTLE_MS = 700;
const HINT = 'Tap the video to show the controls';

function itemFor(item) {
    return { id: item.id, title: item.title, channel: item.channel || '', duration: Number(item.duration) || 0,
        music: !!(item && item.music) };
}
function statusInfo(code, context) {
    if (typeof UIModule.statusInfo === 'function') return UIModule.statusInfo(code, { context: context });
    return { code: code && code.code || code, retryable: true, action: 'retry' };
}

class JiboTubeSkill extends BeSkill {
    constructor() {
        super(...arguments);
        this.pageRequestId = 0; this.generation = 0; this.view = null; this.ui = null; this.client = null; this.store = null;
        this.events = []; this.closing = null; this.leaving = false; this.opened = false;
        this.session = null; this.overlay = null; this.playGeneration = 0; this.tickTimer = null; this.voiceTimer = null;
        this.lastRender = 0; this.voiceRequest = null; this.busyTimer = null; this.lastLikeAt = 0;
        this.state = null;
    }

    open() {
        if (this.view) return;
        const generation = ++this.generation, views = jibo.face && jibo.face.views;
        this.closing = null; this.leaving = false; this.opened = false;
        this.playbackStartedMono = null; this.playbackRecovery = null;
        if (!views || !views.createView || !views.changeView || !global.PIXI) { this.exit({ noElementsOfSurprise: true }); return; }
        this.store = new StoreModule.Store();
        const settings = ServiceModule.settings();
        this.client = new ClientModule.Client(settings);
        this.state = {
            screen: 'loading', tab: 'home', loading: true, status: { code: 'starting_service', busy: true }, query: '', symbols: false,
            recentSearches: this.store.state.searches.slice(0, 4), home: null, homeTop: 0, shelfOffsets: {},
            results: null, resultsPage: 0, details: null, relatedPage: 0, liked: false, thumbUrl: '', prepare: null,
            pendingPlay: false, resumePosition: 0, detailId: '', stack: [], retryTab: 'home', searchBusy: false,
            library: { history: this.store.state.history, likes: this.store.state.likes }, libConfirm: false,
            player: null, voiceText: '', toast: '', toastAt: 0,
            musicHome: null, musicHomeTop: 0, musicLoaded: false, searchMode: 'all', detailsMusic: false,
            captions: [], captionsFor: ''
        };
        this.volumeTarget = null; this.volumeApplyTimer = null; this.volumeRetryTimer = null; this.volumeRetries = 0;
        const ui = this.ui = new UI(this.actions(generation));
        const view = views.createView('View', ui.config(views));
        if (!view) { this.exit({ noElementsOfSurprise: true }); return; }
        lifecycle.prepareView(view);
        this.view = view;
        view.addAction(views.ActionData.CALLBACK, { callback: () => this.leave(generation) }, true, false, views.GESTURE.SWIPE_DOWN);
        views.changeView({ addView: view, transitionOpen: views.TRANSITION.IN, transitionClose: views.TRANSITION.OUT }, () => {
            if (generation !== this.generation || this.view !== view || this.leaving) return;
            this.opened = true;
            try {
                [jibo.jetstream && jibo.jetstream.events.hjHeard, jibo.system && jibo.system.events.touchOn, jibo.system && jibo.system.events.hatchOpen].forEach(event => {
                    if (!event || !event.on || !event.off) return;
                    const stop = () => this.leave(generation);
                    event.on(stop); this.events.push(() => event.off(stop));
                });
                try {
                    const volume = jibo.volume;
                    if (volume && typeof volume.on === 'function') {
                        const onVolume = value => {
                            if (!this.state || !this.state.player) return;
                            if (this.volumeTarget != null && value !== this.volumeTarget) return;
                            if (this.volumeTarget === value) this.volumeTarget = null;
                            this.state.player.volume = value;
                            if (this.overlay && this.state.player.session) this.overlay.update(this.state.player.session, this.state.player, false);
                        };
                        volume.on('change', onVolume); this.events.push(() => { try { volume.removeListener('change', onVolume); } catch (_) {} });
                    }
                } catch (_) {}
                this.tickTimer = timers.setInterval(() => this.tick(generation), 1000);
                if (!this.client.configured()) { this.fail('service_unavailable'); return; }
                this.startService(generation);
            } catch (_) { this.leave(generation); }
        }, () => {
            if (generation === this.generation && this.view === view) { this.leaving = true; this.exit({ noElementsOfSurprise: true }); }
        }, () => {
            if (generation !== this.generation || this.view !== view || this.leaving) return;
            try { ui.decorate(view, global.PIXI, timers); ui.render(this.state); }
            catch (_) { this.leaving = true; this.exit({ noElementsOfSurprise: true }); }
        });
    }

    actions(generation) {
        const call = (name) => (...args) => {
            if (name === 'allowed') return this.active(generation);
            if (name === 'close') return this.leave(generation);
            if (!this.active(generation)) return;
            if (typeof this[name] === 'function') this[name].apply(this, args);
        };
        return {
            allowed: () => this.active(generation),
            close: () => this.leave(generation),
            nav: call('nav'), back: call('back'), key: call('key'), search: call('search'), recent: call('recent'),
            voice: call('voice'), cancelVoice: call('cancelVoice'), card: call('card'), shelfPage: call('shelfPage'),
            shelfAll: call('shelfAll'), homePage: call('homePage'), result: call('result'), page: call('page'),
            openVideo: call('openVideoById'), play: call('play'), like: call('like'), related: call('related'),
            relatedPage: call('relatedPage'), libCard: call('libCard'), clearHistory: call('clearHistory'),
            togglePlay: call('togglePlay'), seek: call('seek'), seekTo: call('seekTo'), next: call('next'),
            replay: call('replay'), cancelAutoplay: call('cancelAutoplay'), playerBack: call('playerBack'), playNext: call('playNext'),
            statusAction: call('statusAction'), resultsAction: call('resultsAction'), volumeUp: call('volumeUp'), volumeDown: call('volumeDown'),
            screenTap: call('screenTap'), toggleSettings: call('toggleSettings'), closeSettings: call('closeSettings'),
            toggleCaptions: call('toggleCaptions'), setLoop: call('setLoop'),
            setAutoplay: call('setAutoplay'), confirmClearHistory: call('confirmClearHistory'), cancelClearHistory: call('cancelClearHistory'),
            setSearchMode: call('setSearchMode'), musicSearchOpen: call('musicSearchOpen'), noop: () => {}
        };
    }

    active(generation) {
        const views = jibo.face && jibo.face.views;
        return generation === this.generation && this.opened && !this.leaving && !!this.view && this.view.state !== 'destroyed' &&
            views && views.currentView === this.view &&
            !(views._viewProcess && views._viewProcess.active);
    }

    render() {
        this.lastRender = Date.now();
        if (this.ui && this.view && this.view.state !== 'destroyed') {
            this.ui.render(this.state);
            this.syncBusyTimer();
        }
    }
    // While something is visibly working (loading, searching, a video getting
    // ready) its progress bar moves; the 1 s tick would make it look stuck.
    busyShown() {
        const f = this.ui && this.ui.frame, s = this.state;
        if (!f || !s || this.leaving) return false;
        if (f.status && f.status.busy) return true;
        if (s.screen === 'results' && s.loading) return true;
        if (s.screen === 'player' && s.player && s.player.starting && !s.player.session) return true;
        return !!(f.detail && f.detail.busy && s.screen === 'details');
    }
    syncBusyTimer() {
        const busy = this.busyShown();
        if (busy && !this.busyTimer) {
            const generation = this.generation;
            this.busyTimer = timers.setInterval(() => {
                if (generation !== this.generation || !this.busyShown()) { this.stopBusyTimer(); return; }
                if (this.ui && this.view && this.view.state !== 'destroyed') this.ui.render(this.state);
            }, 250);
        } else if (!busy) this.stopBusyTimer();
    }
    stopBusyTimer() { if (this.busyTimer) { timers.clearInterval(this.busyTimer); this.busyTimer = null; } }
    // Player controls are drawn as video layers, but taps hit-test the PIXI
    // buttons under them, whose visibility only ui.render sets. Re-render
    // whenever what is tappable changes, or settings chips stay unreachable
    // and taps fall through to the buttons beneath.
    syncPlayerHitAreas() {
        const player = this.state.player;
        const key = player ? [player.generation, player.controlsVisible, player.settingsOpen, player.ended, !!player.session, player.starting, player.paused, !!player.nextTitle].join('|') : '';
        if (key === this.hitAreaKey) return;
        this.hitAreaKey = key;
        this.render();
        // With the face held, transforms update at the next tick; compute them
        // now (no drawing) so a tap right away already hits the new buttons.
        const face = jibo.face;
        if (this.faceHeld && face && face.stage) {
            const parent = face.stage.parent;
            try { face.stage.parent = face._tempDisplayObjectParent; face.stage.updateTransform(); } catch (_) {} finally { face.stage.parent = parent; }
        }
    }
    toast(text) {
        // During playback the BE screen is under the video: use the player's
        // own message layer, which is cut out of the picture.
        const player = this.state.screen === 'player' && this.state.player;
        if (player && player.session && this.overlay) {
            player.toast = text; player.toastUntil = Date.now() + 4000;
            this.overlay.update(player.session, player, false);
            return;
        }
        this.state.toast = text; this.state.toastAt = Date.now(); this.state.toastScreen = this.state.screen + '|' + (this.state.detailId || '');
        this.render();
    }
    volumeLevel() {
        try { return jibo.volume && jibo.volume.currentVolume || 7; } catch (_) { return 7; }
    }
    currentItem() {
        const videoItem = this.state.details && this.state.details.video;
        return videoItem ? Object.assign(itemFor(videoItem), { music: this.state.detailsMusic === true }) : null;
    }
    prepareMessage(job) {
        if (!job) return 'This video could not be prepared.';
        if (this.state.detailsMusic && ['unavailable', 'region', 'age_restricted'].indexOf(job.reason) >= 0) {
            return "This track isn't available to play.";
        }
        return job.message || 'This video could not be prepared.';
    }
    changeVolume(delta) {
        let volume;
        try { volume = jibo.volume; } catch (_) { volume = null; }
        if (!volume || typeof volume.changeVolume !== 'function') { this.toast('Volume is not available'); return; }
        const current = this.state.player ? (this.state.player.volume || volume.currentVolume) : volume.currentVolume;
        const level = Math.max(volume.MIN_VOLUME, Math.min(volume.MAX_VOLUME, current + delta));
        this.volumeTarget = level; this.volumeRetries = 0;
        if (this.state.player) this.state.player.volume = level;
        this.touchControls(false);
        if (this.overlay && this.state.player && this.state.player.session) {
            this.overlay.update(this.state.player.session, this.state.player, false);
        }
        // Coalesce quick taps into one native volume write; the small HUD layer
        // updates immediately, the master volume follows once.
        if (this.volumeApplyTimer) timers.clearTimeout(this.volumeApplyTimer);
        this.volumeApplyTimer = timers.setTimeout(() => {
            this.volumeApplyTimer = null;
            this.applyVolume();
        }, 240);
    }
    applyVolume() {
        let volume;
        try { volume = jibo.volume; } catch (_) { volume = null; }
        if (!volume || this.volumeTarget == null) return;
        if (volume.currentVolume === this.volumeTarget) { this.volumeTarget = null; return; }
        if ((this.volumeRetries || 0) > 5) {
            this.volumeTarget = null;
            if (this.state.player) this.state.player.volume = volume.currentVolume;
            if (this.overlay && this.state.player && this.state.player.session) this.overlay.update(this.state.player.session, this.state.player, false);
            return;
        }
        this.volumeRetries = (this.volumeRetries || 0) + 1;
        try { volume.changeVolume('volumeToValue', this.volumeTarget); } catch (_) {}
        if (this.volumeRetryTimer) timers.clearTimeout(this.volumeRetryTimer);
        this.volumeRetryTimer = timers.setTimeout(() => {
            this.volumeRetryTimer = null;
            if (!jibo.volume || this.volumeTarget == null) return;
            if (jibo.volume.currentVolume !== this.volumeTarget) this.applyVolume();
            else this.volumeTarget = null;
        }, 700);
    }
    volumeUp() { this.changeVolume(1); }
    volumeDown() { this.changeVolume(-1); }

    statusFor(error) {
        return ClientModule.status(error);
    }
    failStatus(error, tab) {
        this.fail(error, tab);
    }
    // A full-screen problem with one next step (see ui.js STATUS).
    fail(code, tab) {
        this.state.loading = false; this.state.screen = 'error';
        this.state.retryTab = tab || this.state.retryTab || 'home';
        this.state.status = this.statusFor(typeof code === 'object' ? code : { code: code || 'failed' });
        this.render();
    }
    // Try again: one attempt at a time. While it runs the button is replaced
    // by a moving bar, so repeated taps cannot queue more service starts.
    retry() {
        if (this.state.status && this.state.status.busy) return;
        const generation = this.generation, tab = this.state.retryTab || 'home';
        this.state.status = { code: 'starting_service', busy: true }; this.state.screen = 'loading'; this.state.loading = true;
        this.render();
        this.startService(generation, tab);
    }
    startService(generation, retryTab) {
        const tab = retryTab || this.state.retryTab || 'home';
        const owned = this.pageRequest();
        const current = () => owned() && this.state.screen === 'loading' && this.state.retryTab === tab;
        return ServiceModule.ensure(this.client.settings).then(ok => {
            if (generation !== this.generation || this.leaving) return false;
            if (!ok) { if (current()) this.failStatus({ code: typeof ServiceModule.status === 'function' && ServiceModule.status() || 'service_unavailable' }, tab); return false; }
            return this.client.providerHealth().then(() => {
                // The user may already have moved to another tab.
            if (!current()) return;
                if (tab === 'music') { this.state.musicHome = null; this.loadMusicHome(generation); }
                else if (tab === 'trending') this.showTrending();
                else this.loadHome(generation);
            });
        }).catch(error => { if (current()) this.failStatus(error, tab); });
    }

    pageRequest() {
        const generation = this.generation, request = ++this.pageRequestId;
        return () => generation === this.generation && request === this.pageRequestId && !this.leaving;
    }

    loadHome(generation) {
        if (!this.active(generation) && this.opened) return;
        const current = this.pageRequest();
        this.state.loading = true; this.state.screen = 'loading'; this.state.retryTab = 'home';
        this.state.status = { code: 'loading', busy: true };
        this.render();
        this.client.home(this.store.payload()).then(home => {
            if (!current()) return;
            this.state.home = this.enrichHome(home);
            if (this.state.tab !== 'home' || this.state.screen !== 'loading') { this.render(); return; }
            this.state.loading = false; this.state.status = null; this.state.screen = 'home'; this.state.tab = 'home';
            this.state.stack = [];
            this.render();
        }).catch(error => {
            if (!current()) return;
            if (this.state.tab !== 'home' || this.state.screen !== 'loading') return;
            this.failStatus(error, 'home');
        });
    }

    loadMusicHome(generation) {
        if (!this.active(generation) && this.opened) return;
        const current = this.pageRequest();
        this.state.loading = true; this.state.screen = 'loading'; this.state.retryTab = 'music';
        this.state.status = { code: 'loading', busy: true };
        this.render();
        this.client.musicHome(this.store.payload()).then(home => {
            if (!current()) return;
            this.state.musicHome = this.enrichHome(home);
            this.state.musicLoaded = true;
            if (this.state.tab !== 'music' || this.state.screen !== 'loading') { this.render(); return; }
            this.state.loading = false; this.state.status = null;
            this.state.screen = 'music'; this.state.tab = 'music'; this.state.stack = [];
            this.render();
        }).catch(error => {
            if (!current()) return;
            if (this.state.tab !== 'music' || this.state.screen !== 'loading') return;
            this.failStatus(error, 'music');
        });
    }

    enrich(item, size) {
        if (!item) return item;
        return Object.assign({}, item, { thumbUrl: this.client.thumb(item, size || 'mqdefault') });
    }
    enrichHome(home) {
        const copy = Object.assign({}, home, { rows: [] });
        (home.rows || []).slice(0, MAX_HOME_ROWS).forEach(row => {
            copy.rows.push(Object.assign({}, row, { items: (row.items || []).map(item => this.enrich(item, 'mqdefault')) }));
        });
        return copy;
    }

    // The rail: switching tabs starts a fresh history for Back.
    nav(tab) {
        this.pageRequestId++; this.state.loading = false;
        this.state.searchBusy = false; this.searchToken = (this.searchToken || 0) + 1;
        this.cancelVoice(false);
        this.stopVideo('nav');
        this.state.player = null; this.dropOverlay();
        this.state.stack = []; this.state.libConfirm = false; this.state.searchFrom = '';
        if (tab === 'home') {
            this.state.tab = 'home';
            if (this.state.home) { this.state.screen = 'home'; this.state.status = null; this.state.loading = false; this.render(); }
            else this.loadHome(this.generation);
        } else if (tab === 'music') {
            this.state.tab = 'music';
            if (this.state.musicHome) { this.state.screen = 'music'; this.state.status = null; this.state.loading = false; this.render(); }
            else this.loadMusicHome(this.generation);
        } else if (tab === 'trending') {
            this.state.tab = 'trending';
            this.showTrending();
        } else if (tab === 'search') {
            this.state.tab = 'search'; this.state.screen = 'search'; this.state.status = null; this.state.loading = false; this.render();
        } else if (tab === 'library') {
            this.state.tab = 'library'; this.state.status = null; this.state.loading = false; this.openLibrary();
        }
    }

    showTrending() {
        const row = this.state.home && this.state.home.rows.filter(item => item.id === 'trending')[0];
        if (row) {
            this.state.results = { title: 'Trending now', items: row.items.slice(), back: false };
            this.state.resultsPage = 0; this.state.screen = 'results'; this.state.status = null; this.state.loading = false;
            this.render();
            return;
        }
        const current = this.pageRequest();
        this.state.loading = true; this.state.screen = 'loading'; this.state.retryTab = 'trending';
        this.state.status = { code: 'loading', busy: true };
        this.render();
        this.client.search('trending now').then(result => {
            if (!current() || this.state.tab !== 'trending' || this.state.screen !== 'loading') return;
            this.state.results = { title: 'Trending now', items: (result.items || []).map(item => this.enrich(item, 'mqdefault')), back: false };
            this.state.resultsPage = 0; this.state.loading = false; this.state.status = null; this.state.screen = 'results';
            this.render();
        }).catch(error => {
            if (!current() || this.state.tab !== 'trending' || this.state.screen !== 'loading') return;
            this.failStatus(error, 'trending');
        });
    }

    openLibrary() {
        this.pageRequestId++; this.state.loading = false;
        this.state.library = { history: this.store.state.history.map(item => this.enrich(item, 'mqdefault')),
            likes: this.store.state.likes.map(item => this.enrich(item, 'mqdefault')) };
        this.state.screen = 'library'; this.state.status = null; this.state.libConfirm = false;
        this.render();
    }

    // Back history. Each entry restores exactly what the user saw: a screen
    // plus the context it needs (results and page, a video's details).
    snapshot() {
        const s = this.state;
        const entry = { screen: s.screen === 'voice' ? 'search' : s.screen, tab: s.tab, query: s.query, symbols: s.symbols,
            searchMode: s.searchMode, homeTop: s.homeTop, musicHomeTop: s.musicHomeTop, shelfOffsets: Object.assign({}, s.shelfOffsets) };
        if (entry.screen === 'results') { entry.results = s.results; entry.resultsPage = s.resultsPage || 0; }
        if (entry.screen === 'details') {
            entry.details = s.details; entry.detailId = s.detailId; entry.relatedPage = s.relatedPage || 0; entry.thumbUrl = s.thumbUrl;
            entry.prepare = s.prepare; entry.liked = s.liked; entry.detailsMusic = s.detailsMusic; entry.resumePosition = s.resumePosition;
        }
        if (entry.screen === 'search') { entry.searchFrom = s.searchFrom || ''; entry.searchMode = s.searchMode; }
        return entry;
    }
    pushScreen() {
        const s = this.state;
        if (['home', 'music', 'results', 'details', 'search', 'library', 'voice'].indexOf(s.screen) < 0) return;
        s.stack = s.stack || [];
        const entry = this.snapshot(), top = s.stack[s.stack.length - 1];
        // Never stack the same details twice (Next/autoplay chains replace).
        if (top && top.screen === 'details' && entry.screen === 'details' && top.detailId === entry.detailId) return;
        s.stack = s.stack.concat([entry]).slice(-MAX_STACK);
    }
    restore(entry) {
        const s = this.state;
        s.status = null; s.loading = false; s.libConfirm = false;
        s.tab = entry.tab || s.tab;
        s.query = entry.query || ''; s.symbols = !!entry.symbols; s.searchMode = entry.searchMode || 'all';
        s.homeTop = entry.homeTop || 0; s.musicHomeTop = entry.musicHomeTop || 0; s.shelfOffsets = Object.assign({}, entry.shelfOffsets);
        if (entry.screen === 'results') { s.results = entry.results; s.resultsPage = entry.resultsPage || 0; }
        if (entry.screen === 'details') {
            s.details = entry.details; s.detailId = entry.detailId; s.relatedPage = entry.relatedPage || 0; s.thumbUrl = entry.thumbUrl;
            s.prepare = entry.prepare && entry.prepare.state === 'error' ? null : entry.prepare; s.liked = this.store.liked(entry.detailId);
            s.detailsMusic = entry.detailsMusic; s.resumePosition = this.resumeFor(entry.detailId, entry.details && entry.details.video);
        }
        if (entry.screen === 'search') { s.searchFrom = entry.searchFrom || ''; s.searchMode = entry.searchMode || s.searchMode; }
        if (entry.screen === 'home' && !s.home) { s.screen = 'home'; this.loadHome(this.generation); return; }
        if (entry.screen === 'music' && !s.musicHome) { s.screen = 'music'; this.loadMusicHome(this.generation); return; }
        if (entry.screen === 'library') { this.openLibrary(); return; }
        s.screen = entry.screen;
        this.render();
    }
    resumeFor(id, video) {
        const history = this.store.state.history.filter(entry => entry.id === id)[0];
        return history && history.position < ((video && video.duration) || 86400) - 15 ? history.position : 0;
    }

    card(s, t) {
        const shelf = this.shelves()[s];
        if (!shelf || !shelf.cards[t]) return;
        this.openVideoById(shelf.cards[t].id, shelf.cards[t]);
    }
    libCard(s, t) {
        const shelf = this.state.library && [this.state.library.history.filter(item => item.position > 0).slice(0, 8),
            this.state.library.likes.slice(0, 8)][s];
        if (!shelf || !shelf[t]) return;
        this.openVideoById(shelf[t].id, shelf[t]);
    }
    activeRows() {
        if (this.state.screen === 'music') return this.state.musicHome ? this.state.musicHome.rows : [];
        return this.state.home ? this.state.home.rows : [];
    }
    activeTop() {
        return this.state.screen === 'music' ? (this.state.musicHomeTop || 0) : (this.state.homeTop || 0);
    }
    shelves() {
        const rows = this.activeRows();
        const top = Math.max(0, Math.min(this.activeTop(), Math.max(0, rows.length - 2)));
        const out = [];
        for (let s = 0; s < 2; s++) {
            const row = rows[top + s];
            if (!row) { out.push(null); continue; }
            const offset = Math.max(0, Math.min(this.state.shelfOffsets[row.id] || 0, Math.max(0, row.items.length - 1)));
            out.push({ row: row, offset: offset, cards: row.items.slice(offset, offset + 4) });
        }
        return out;
    }
    shelfPage(s, dir) {
        const shelf = this.shelves()[s];
        if (!shelf) return;
        const offset = Math.max(0, Math.min(shelf.offset + dir * 4, Math.max(0, shelf.row.items.length - 1)));
        this.state.shelfOffsets = Object.assign({}, this.state.shelfOffsets);
        this.state.shelfOffsets[shelf.row.id] = offset;
        this.render();
    }
    shelfAll(s) {
        const shelf = this.shelves()[s];
        if (!shelf) return;
        this.pushScreen();
        this.state.results = { title: shelf.row.title, items: shelf.row.items.slice(), back: true, music: this.state.screen === 'music' };
        this.state.resultsPage = 0; this.state.screen = 'results';
        this.render();
    }
    homePage(dir) {
        const rows = this.activeRows();
        const top = Math.max(0, Math.min(this.activeTop() + dir * 2, Math.max(0, rows.length - 2)));
        if (this.state.screen === 'music') this.state.musicHomeTop = top; else this.state.homeTop = top;
        this.render();
    }

    key(ch) {
        if (!ch) return;
        if (ch === 'symbols') this.state.symbols = !this.state.symbols;
        else if (ch === 'backspace') this.state.query = this.state.query.slice(0, -1);
        else if (ch === 'clear') this.state.query = '';
        else if (ch === 'space') this.state.query += ' ';
        else this.state.query += ch;
        this.state.query = this.state.query.slice(0, 120);
        this.render();
    }
    recent(index) {
        const query = this.state.recentSearches[index];
        if (!query) return;
        this.state.query = query;
        this.search();
    }
    setSearchMode(mode) {
        this.state.searchMode = mode === 'music' ? 'music' : 'all';
        if (this.state.screen === 'results' && this.state.query) { this.state.searchBusy = false; this.search(); }
        else this.render();
    }
    musicSearchOpen() {
        this.pageRequestId++; this.state.loading = false;
        this.pushScreen();
        this.state.searchMode = 'music';
        this.state.searchFrom = 'music';
        this.state.screen = 'search';
        this.state.query = '';
        this.state.status = null;
        this.render();
    }
    // One search at a time: while it runs, Search shows "Searching…" and is
    // locked, so a double tap cannot send the same request twice.
    search() {
        const query = String(this.state.query || '').trim();
        if (!query) { this.toast('Type something to search'); return; }
        if (this.state.searchBusy) return;
        const current = this.pageRequest();
        const music = this.state.searchMode === 'music';
        this.store.search(query);
        this.state.recentSearches = this.store.state.searches.slice(0, 4);
        if (this.state.screen === 'search' || this.state.screen === 'voice') this.pushScreen();
        const token = this.searchToken = (this.searchToken || 0) + 1;
        this.state.results = { title: '“' + query + '”', query: query, items: [], back: true, music: music };
        this.state.resultsPage = 0; this.state.screen = 'results'; this.state.loading = true; this.state.searchBusy = true; this.state.status = null;
        this.render();
        const request = music ? this.client.musicSearch(query) : this.client.search(query);
        const finish = () => { if (token === this.searchToken) this.state.searchBusy = false; };
        request.then(result => {
            finish();
            if (!current() || token !== this.searchToken || this.state.screen !== 'results' || this.state.results.query !== query) return;
            this.state.results = { title: '“' + query + '”', query: query, items: (result.items || []).map(item => this.enrich(item, 'mqdefault')),
                back: true, music: music || !!result.music };
            this.state.loading = false;
            this.render();
        }).catch(error => {
            finish();
            if (!current() || token !== this.searchToken || this.state.screen !== 'results' || this.state.results.query !== query) return;
            this.state.loading = false; this.state.status = this.statusFor(error);
            this.state.results = { title: '“' + query + '”', query: query, items: [], back: true, music: music,
                error: this.state.status.code, retryable: this.state.status.retryable };
            this.render();
        });
    }
    // The button under "Nothing found" or a search problem.
    resultsAction() {
        const result = this.state.results;
        if (!result || this.state.loading) return;
        const note = this.ui && this.ui.frame && this.ui.frame.resultsNote;
        if (note && note.action === 'close') { this.leave(this.generation); return; }
        if (note && note.retry && result.query) { this.state.query = result.query; this.state.screen = 'search'; this.state.stack = this.state.stack.slice(0, -1); this.search(); return; }
        this.back();
    }

    page(dir) {
        if (!this.state.results) return;
        const pages = Math.max(1, Math.ceil(this.state.results.items.length / 4));
        this.state.resultsPage = Math.max(0, Math.min(pages - 1, (this.state.resultsPage || 0) + dir));
        this.render();
    }
    result(index) {
        const item = this.state.results && this.state.results.items[(this.state.resultsPage || 0) * 4 + index];
        if (item) this.openVideoById(item.id, item);
    }
    // The one Back: return to exactly the previous screen. With nothing to go
    // back to, go to the current tab's top screen (never a dead end).
    back() {
        this.pageRequestId++; this.state.loading = false;
        if (this.state.screen === 'player') { this.playerBack(); return; }
        if (this.state.screen === 'voice') { this.cancelVoice(true); return; }
        this.cancelVoice(false);
        if (this.state.screen === 'details') { this.stopVideo('back'); this.state.player = null; this.dropOverlay(); }
        this.state.searchBusy = false; this.searchToken = (this.searchToken || 0) + 1;
        const stack = this.state.stack || [];
        const entry = stack.length ? stack[stack.length - 1] : null;
        this.state.stack = stack.slice(0, -1);
        if (entry) { this.restore(entry); return; }
        const tab = this.state.tab === 'music' ? 'music' : this.state.tab === 'library' ? 'library' : this.state.tab === 'search' ? 'search' : 'home';
        this.nav(tab === 'search' && this.state.screen === 'search' ? 'home' : tab);
    }

    openVideoById(id, item, autoplay, reload) {
        if (!id) return;
        const current = this.pageRequest();
        this.playbackRecovery = null;
        this.cancelVoice(false);
        this.stopVideo('open');
        // Opening from a list or another video's details remembers where you
        // were. From the player (Next, autoplay) the finished video's details
        // are replaced, so Back returns to where the chain began.
        if (!reload) this.pushScreen();
        this.state.detailId = id; this.state.relatedPage = 0; this.state.liked = this.store.liked(id);
        this.state.captions = []; this.state.captionsFor = '';
        this.state.detailsMusic = !!(item && item.music) || this.state.tab === 'music' || this.state.searchMode === 'music';
        const known = item || { id: id, title: 'Loading video…', channel: '', duration: 0 };
        this.state.details = { video: this.enrich(known, 'hq720'), related: [], rows: [], sponsor: { enabled: true, segments: [] }, loaded: false };
        this.state.thumbUrl = this.client.thumb(known, 'hq720');
        this.state.prepare = null; this.state.pendingPlay = !!autoplay;
        this.state.resumePosition = this.resumeFor(id, known);
        this.state.screen = 'details'; this.state.status = null; this.state.loading = false;
        this.state.player = null; this.dropOverlay();
        this.render();
        this.client.video(id).then(details => {
            if (!current() || this.state.detailId !== id) return;
            details.video = this.enrich(details.video, 'hq720');
            details.related = (details.related || []).map(related => this.enrich(related, 'mqdefault'));
            details.rows = (details.rows || []).map(row => Object.assign({}, row, { items: (row.items || []).map(related => this.enrich(related, 'mqdefault')) }));
            details.loaded = true;
            this.state.details = details;
            this.state.thumbUrl = details.video.thumbUrl;
            this.state.liked = this.store.liked(id);
            if (!(this.state.prepare && this.state.prepare.state === 'error')) this.state.prepare = { id: id, state: 'ready', cleanDuration: details.video.duration || 0 };
            this.state.resumePosition = this.resumeFor(id, details.video);
            if (this.state.pendingPlay) { this.state.pendingPlay = false; if (!this.playerStarting()) this.startPlayer(this.state.resumePosition || 0); else this.render(); return; }
            this.render();
        }).catch(error => {
            if (!current() || this.state.detailId !== id || this.state.screen !== 'details') return;
            this.state.pendingPlay = false;
            if (this.playerStarting()) return;
            // The details page itself says what went wrong and what to do.
            const failure = this.statusFor(error);
            this.state.status = failure;
            this.state.prepare = { id: id, state: 'error', stage: 'details', reason: failure.code, message: failure.body };
            this.render();
        });
    }

    playerStarting() {
        const player = this.state.player;
        return !!player && player.starting && player.generation === this.playGeneration;
    }
    // Play, or the details page's one next step after a problem: Try again
    // (only when retryable), Pick another video (back), or Close JiboTube.
    play() {
        if (!this.state.details || this.playerStarting()) return;
        const job = this.state.prepare;
        if (job && job.state === 'preparing') return;
        const detail = this.ui && this.ui.frame && this.ui.frame.screen === 'details' ? this.ui.frame.detail : null;
        const failed = (job && job.state === 'error') || (detail && detail.error);
        if (failed) {
            const action = detail && detail.error ? detail.error.action : statusInfo({ code: job.reason }, 'details').action;
            if (action === 'close') { this.leave(this.generation); return; }
            if (action !== 'retry') { this.back(); return; }
            this.state.status = null;
            if ((job && job.stage === 'details') || (this.state.details && this.state.details.loaded === false)) {
                const video = this.state.details.video;
                this.openVideoById(this.state.detailId, video && video.id ? video : null, false, true);
                return;
            }
            this.state.prepare = { id: this.state.detailId, state: 'ready', cleanDuration: job && job.cleanDuration || 0 };
        }
        this.playbackRecovery = null;
        this.state.pendingPlay = false;
        this.startPlayer(this.state.resumePosition || 0);
    }
    // Like toggles; a quick second tap (a double tap) is not an unlike.
    like() {
        const videoItem = this.state.details && this.state.details.video;
        if (!videoItem) return;
        if (Date.now() - (this.lastLikeAt || 0) < LIKE_SETTLE_MS) return;
        this.lastLikeAt = Date.now();
        this.state.liked = this.store.like(Object.assign(itemFor(videoItem), { music: this.state.detailsMusic === true }));
        this.state.library = { history: this.store.state.history.map(item => this.enrich(item, 'mqdefault')),
            likes: this.store.state.likes.map(item => this.enrich(item, 'mqdefault')) };
        this.toast(this.state.liked ? 'Added to Liked videos' : 'Removed from Liked videos');
        this.render();
    }
    related(index) {
        const item = this.state.details && this.state.details.related[(this.state.relatedPage || 0) * 3 + index];
        if (item) this.openVideoById(item.id, item);
    }
    relatedPage(dir) {
        const related = this.state.details ? this.state.details.related : [];
        const pages = Math.max(1, Math.ceil(related.length / 3));
        this.state.relatedPage = Math.max(0, Math.min(pages - 1, (this.state.relatedPage || 0) + dir));
        this.render();
    }

    startPlayer(position, serviceRetried, snapAfter) {
        const details = this.state.details;
        if (!details || !details.video) return;
        const v = details.video;
        if (this.playbackStartedMono == null) this.playbackStartedMono = monotonic();
        if (monotonic() - this.playbackStartedMono >= SESSION_LIMIT_MS) {
            this.stopVideo('session_limit'); this.state.player = null; this.dropOverlay(); this.failStatus({ code: 'session_limit' }); return;
        }
        const segments = (details.sponsor && details.sponsor.segments) || [];
        const next = (details.related && details.related[0]) || null;
        let target = Math.max(0, Math.min(Math.max(0, (Number(v.duration) || 0) - 1), Number(position) || 0));
        for (let i = 0; i < segments.length; i++) {
            if (target >= segments[i].start && target < segments[i].end) { target = segments[i].end; snapAfter = true; break; }
        }
        this.stopVideo('restart');
        this.dropOverlay();
        // Why this start happens (seek, resume), for the words on screen.
        const startText = this.startText || ''; this.startText = '';
        const generation = ++this.playGeneration;
        const player = this.state.player = {
            id: v.id, title: v.title, channel: v.channel || '', duration: Number(v.duration) || 0,
            base: target, position: target, startedAt: 0, startedMono: null, paused: false, starting: true, ended: false, endedAt: 0,
            autoplay: this.store.state.settings.autoplay !== false, autoplayIn: 0, nextItem: next,
            sponsorCount: segments.length, segments: segments, nextTitle: next ? next.title : '',
            statusText: startText || 'Buffering…', toast: '', toastUntil: 0, generation: generation, volume: this.volumeLevel(),
            overlayRecoveries: 0, lastStatus: 0, serviceRetried: !!serviceRetried, skipFloor: target, snapAfter: !!snapAfter,
            loop: this.store.state.settings.loop === true, captionsOn: this.store.state.settings.captions === true,
            captionsAvailable: this.state.captionsFor === v.id ? this.state.captions.length > 0 : undefined,
            captionText: '', settingsOpen: false, controlsVisible: true, controlsAlpha: 1, controlsAt: Date.now(),
            controlsHideTimer: null, fadeTimer: null
        };
        this.state.screen = 'player'; this.state.status = null;
        this.state.tab = this.state.tab || 'home';
        this.render();
        this.client.stream(v.id, target, snapAfter).then(info => {
            if (generation !== this.playGeneration || this.state.player !== player || this.leaving) return;
            player.base = Number(info.start) || 0;
            player.position = player.base;
            player.duration = Number(info.duration) || player.duration;
            player.height = Number(info.height) || 0;
            // Play can be tapped before the details arrive; the stream knows the title.
            if (info.title) player.title = info.title;
            if (info.channel) player.channel = info.channel;
            player.segments = info.segments || segments;
            player.sponsorCount = player.segments.length;
            player.statusText = startText || 'Starting…';
            if (this.state.captionsFor !== v.id) {
                this.client.captions(v.id).then(result => {
                    if (this.state.player !== player) return;
                    this.state.captions = result && Array.isArray(result.cues) ? result.cues : [];
                    this.state.captionsFor = v.id;
                    player.captionsAvailable = this.state.captions.length > 0;
                }).catch(() => {});
            }
            this.dropOverlay();
            this.overlay = new Overlay(this.view && this.view.stage, () => this.paintFace());
            const session = this.session = video.open({
                url: this.client.streamUrl(info.video),
                audioUrl: info.audio ? this.client.streamUrl(info.audio) : '',
                videoMime: info.videoMime, audioMime: info.audioMime, audio: !!info.audio,
                stage: this.view && this.view.stage, duration: Math.max(0, player.duration - player.base)
            });
            player.session = session;
            this.overlay.update(session, player, true);
            this.syncPlayerHitAreas();
            this.store.watched(Object.assign(this.currentItem() || itemFor(v), { duration: player.duration }), player.base);
            session.on('state', event => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                if (event.state === 'starting') {
                    // The texture has joined the scene: raise the startup controls above it.
                    this.overlay.reset(); this.overlay.update(session, player, true);
                } else if (event.state === 'visible') {
                    player.starting = false;
                    this.holdFace(false);
                    this.overlay.update(session, player, true);
                } else if (event.state === 'playing') {
                    player.starting = false;
                    this.holdFace(false);
                    // Paused while the stream was still starting: honor it now,
                    // or the video plays under a paused UI.
                    if (player.paused) { session.pause(); this.overlay.update(session, player, true); return; }
                    player.controlsAt = Date.now();
                    if (!player.startedAt) { player.startedAt = Date.now(); player.startedMono = monotonic(); }
                    this.syncPlayerHitAreas();
                    this.overlay.update(session, player, true);
                } else if (event.state === 'buffering') {
                    player.starting = true; player.statusText = 'Buffering…';
                    if (this.overlay) this.overlay.update(session, player, true);
                    this.syncPlayerHitAreas();
                } else if (event.state === 'ended') {
                    this.endPlayer(player);
                } else if (event.state === 'stopped') {
                    this.holdFace(false);
                    player.position = Math.max(player.position || 0, player.base + (Number(event.position) || 0));
                    player.session = null;
                    if (this.session === session) this.session = null;
                    if (this.state.player !== player) return;
                    if (/^interrupted/.test(event.reason || '')) { this.leave(this.generation); return; }
                    if (/^(restart|request|user|open|nav|ended|close|leave|playback_failed)$/.test(event.reason || '')) return;
                    if (event.reason === 'player_exit') { this.playerExited(player); return; }
                    if (event.confirmed === false) { this.playbackFailed(player, null, 'teardown_unconfirmed'); return; }
                    if (/^(host_exit|host_unavailable|play_error|playback_stalled|window_timeout|start_failed|playback_failed)$/.test(event.reason || '')) { this.playerExited(player, this.mediaFailureCode(event.error || player.lastError || { reason: event.reason })); return; }
                    if (!player.ended && !player.paused) { player.paused = true; player.position = this.playerPosition(player); this.overlay.update(session, player, true); }
                }
            });
            session.on('error', event => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                // A transient branch error (for example the audio socket) should
                // not tear down a video that is still playing.
                if (!player.errorHandled) {
                    player.errorHandled = true; player.lastError = event;
                    player.toast = 'Playback issue';
                    player.toastUntil = Date.now() + 4000;
                }
                if (this.overlay) this.overlay.update(session, player, true);
            });

        }).catch(error => {
            if (generation !== this.playGeneration || this.state.player !== player) return;
            // The service answered but cannot stream this video (for example a
            // just-ended live stream, which YouTube serves without an index).
            const failure = this.statusFor(error);
            if (!failure.retryable || (error && error.code && ['network_unavailable', 'timeout', 'service_unavailable', 'unauthorized'].indexOf(error.code) < 0)) { this.playbackFailed(player, null, failure); return; }
            if (player.serviceRetried) { this.playbackFailed(player, null, failure); return; }
            player.serviceRetried = true;
            player.statusText = 'Starting the local service…';
            this.render();
            return ServiceModule.ensure(this.client.settings).then(ok => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                if (ok) this.startPlayer(target, true, snapAfter);
                else this.playbackFailed(player, null, 'service_unavailable');
            }).catch(() => { if (generation === this.playGeneration && this.state.player === player) this.playbackFailed(player, null, 'service_unavailable'); });
        });
    }
    playerPosition(player) {
        if (player.paused || player.ended || !player.session) return Math.max(0, Math.min(player.duration, player.position || player.base || 0));
        return Math.max(0, Math.min(player.duration, player.base + player.session.position()));
    }
    mediaFailureCode(error) {
        const reason = error && error.reason || '';
        if (reason === 'media_4' || /unsupported_stream_codec/.test(error && error.detail || '')) return 'unsupported_format';
        if (reason === 'media_3') return 'unsupported_format';
        if (reason === 'media_timeout') return 'timeout';
        if (/media_2|media_buffer/.test(reason)) return 'network_unavailable';
        if (reason === 'playback_stalled') return 'playback_stalled';
        return 'playback_failed';
    }
    clearPlayerTimers(player) {
        if (!player) return;
        if (player.controlsHideTimer) { timers.clearTimeout(player.controlsHideTimer); player.controlsHideTimer = null; }
        if (player.fadeTimer) { timers.clearTimeout(player.fadeTimer); player.fadeTimer = null; }
    }
    touchControls(force) {
        const player = this.state.player;
        if (!player) return;
        const wasVisible = player.controlsVisible;
        if (player.controlsHideTimer) { timers.clearTimeout(player.controlsHideTimer); player.controlsHideTimer = null; }
        if (player.fadeTimer) { timers.clearTimeout(player.fadeTimer); player.fadeTimer = null; }
        player.controlsVisible = true; player.controlsAlpha = 1; player.controlsAt = Date.now();
        player.overlayWarned = false; player.overlayRecoveries = 0;
        if (player.toast === HINT) { player.toast = ''; player.toastUntil = 0; }
        if ((force || !wasVisible) && this.overlay && player.session) this.overlay.update(player.session, player, true);
        this.syncPlayerHitAreas();
    }
    showControls() {
        const player = this.state.player;
        if (!player || player.ended) return;
        this.touchControls(true);
    }
    hideControls() {
        const player = this.state.player;
        if (!player || !player.controlsVisible || player.settingsOpen || player.paused || player.ended || player.starting) return;
        // No intermediate fade frame: each one redrew every control layer.
        player.controlsAlpha = 1; player.controlsVisible = false;
        // The first time they hide, say how to bring them back.
        if (!player.hinted) { player.hinted = true; player.toast = HINT; player.toastUntil = Date.now() + 3500; }
        if (this.overlay && player.session) this.overlay.update(player.session, player, false);
        this.syncPlayerHitAreas();
    }
    // A tap on the picture only shows or hides the controls; it never starts,
    // pauses or seeks (the big Play/Pause button does that).
    screenTap() {
        const player = this.state.player;
        if (!player) return;
        if (player.settingsOpen) { this.closeSettings(); return; }
        if (!player.controlsVisible) { this.showControls(); return; }
        this.hideControls();
    }
    toggleSettings() {
        const player = this.state.player;
        if (!player) return;
        player.settingsOpen = !player.settingsOpen;
        this.touchControls(true);
        if (this.overlay && player.session) this.overlay.update(player.session, player, true);
        this.syncPlayerHitAreas();
    }
    closeSettings() {
        const player = this.state.player;
        if (!player) return;
        player.settingsOpen = false;
        this.touchControls(true);
        if (this.overlay && player.session) this.overlay.update(player.session, player, true);
        this.syncPlayerHitAreas();
    }
    toggleCaptions(value) {
        const player = this.state.player;
        if (!player) return;
        const on = typeof value === 'boolean' ? value : !player.captionsOn;
        player.captionsOn = on;
        this.store.setCaptions(on);
        if (on && this.state.captionsFor !== player.id) this.fetchCaptions();
        if (on && this.state.captionsFor === player.id && !this.state.captions.length) { this.toast('No captions available'); player.captionsOn = false; this.store.setCaptions(false); }
        this.updateCaption(player);
        this.touchControls(true);
        if (this.overlay && player.session) this.overlay.update(player.session, player, true);
    }
    fetchCaptions() {
        const id = this.state.detailId;
        if (!id) return;
        this.client.captions(id).then(result => {
            if (this.state.detailId !== id) return;
            this.state.captions = result && Array.isArray(result.cues) ? result.cues : [];
            this.state.captionsFor = id;
            if (this.state.player) {
                this.state.player.captionsAvailable = this.state.captions.length > 0;
                if (!this.state.captions.length && this.state.player.captionsOn) { this.state.player.captionsOn = false; this.store.setCaptions(false); this.toast('No captions available'); }
                this.updateCaption(this.state.player);
            }
        }).catch(() => {});
    }
    currentCaption(player) {
        if (!player || !player.captionsOn) return '';
        const cues = this.state.captions || [];
        const at = player.position;
        for (let i = 0; i < cues.length; i++) {
            if (at >= cues[i].start && at < cues[i].end) return cues[i].text;
            if (cues[i].start > at) break;
        }
        return '';
    }
    updateCaption(player) {
        if (!player) return;
        const text = this.currentCaption(player);
        if (text === player.captionText) return;
        player.captionText = text;
        if (this.overlay && player.session) this.overlay.update(player.session, player, false);
    }
    setLoop(value) {
        const player = this.state.player;
        if (!player) return;
        player.loop = value === true;
        this.store.setLoop(player.loop);
        this.touchControls(true);
        if (this.overlay && player.session) this.overlay.update(player.session, player, true);
    }
    setAutoplay(value) {
        const player = this.state.player;
        if (!player) return;
        player.autoplay = value === true;
        this.store.setAutoplay(player.autoplay);
        this.touchControls(true);
        if (this.overlay && player.session) this.overlay.update(player.session, player, true);
    }

    // Texture playback keeps the face renderer active; teardown restores any prior hold.
    holdFace(hold) {
        const face = jibo.face;
        if (!face || !!this.faceHeld === !!hold) return;
        if (this.faceTimer) { timers.clearInterval(this.faceTimer); this.faceTimer = null; }
        try {
            if (hold) {
                this.faceWasPaused = face._paused === true; face.paused = true; this.faceHeld = true;
                this.faceTimer = timers.setInterval(() => {
                    if (!this.faceHeld) return;
                    try { face.paused = false; face.update(FACE_HELD_MS); } catch (_) {} finally { face.paused = true; }
                }, FACE_HELD_MS);
            } else { this.faceHeld = false; face.paused = this.faceWasPaused === true; }
        } catch (_) { this.faceHeld = false; }
    }
    // Draw BE now: the overlay is PIXI sprites seen through holes in the video,
    // and the held face renderer would otherwise show them on its next tick.
    paintFace() {
        const face = jibo.face;
        if (!this.faceHeld || !face) return;
        try { face.paused = false; face.update(0); } catch (_) {} finally { face.paused = true; }
    }
    dropOverlay() {
        if (this.overlay) { try { this.overlay.destroy(); } catch (_) {} }
        this.overlay = null;
    }
    stopVideo(reason) {
        this.holdFace(false);
        if (this.state && this.state.player) this.clearPlayerTimers(this.state.player);
        const session = this.session; this.session = null;
        this.playGeneration++;
        return session ? session.stop(reason || 'stop') : Promise.resolve();
    }
    togglePlay() {
        const player = this.state.player;
        if (!player || this.playerStarting()) return;
        this.touchControls(false);
        if (player.ended) { this.replay(); return; }
        if (player.paused) this.resumePlayer();
        else this.pausePlayer();
    }
    pausePlayer() {
        const player = this.state.player;
        if (!player || player.paused || player.ended) return;
        player.position = this.playerPosition(player);
        if (player.session) player.session.pause();
        player.paused = true;
        this.touchControls(false);
        this.store.watched(Object.assign(this.currentItem() || itemFor(this.state.details.video), { duration: player.duration }), player.position);
        if (this.overlay) this.overlay.update(player.session, player, true);
        this.syncPlayerHitAreas();
    }
    resumePlayer() {
        const player = this.state.player;
        if (!player || !player.paused || this.playerStarting()) return;
        player.paused = false; this.touchControls(true);
        if (player.session) player.session.show();
        else this.startPlayer(player.position);
        this.syncPlayerHitAreas();
    }
    seek(delta) {
        const player = this.state.player;
        if (!player) return;
        const position = Math.max(0, Math.min(player.duration - 1, this.playerPosition(player) + Number(delta || 0)));
        this.seekToTime(position);
    }
    seekTo(fraction) {
        const player = this.state.player;
        if (!player) return;
        this.seekToTime(Math.max(0, Math.min(player.duration - 1, player.duration * Math.max(0, Math.min(1, Number(fraction) || 0)))));
    }
    seekToTime(position, snapAfter) {
        const player = this.state.player;
        if (!player || this.playerStarting()) return;
        player.position = position; player.paused = false; player.starting = true; player.ended = false;
        player.statusText = 'Seeking…';
        this.startText = 'Seeking…';
        this.startPlayer(position, false, snapAfter);
    }
    next() {
        const player = this.state.player;
        if (!player) return;
        if (player.nextItem) this.openVideoById(player.nextItem.id, player.nextItem, true);
        else this.toast('No next video');
    }
    // Recover only after confirmed old-session teardown, once for this video
    // attempt. Elapsed wall time never replenishes the automatic retry budget.
    playerExited(player, code) {
        this.recoverPlayer(player, code || 'playback_failed');
    }
    recoverPlayer(player, code) {
        if (!this.state || this.state.player !== player || this.leaving) return;
        const recovery = this.playbackRecovery;
        if (!this.statusFor({ code: code }).retryable || (recovery && recovery.id === player.id && recovery.used)) { this.playbackFailed(player, null, code); return; }
        this.playbackRecovery = { id: player.id, used: true };
        const at = this.playerPosition(player), generation = this.playGeneration;
        player.starting = true; player.statusCode = 'reconnecting'; player.statusText = 'Reconnecting once…';
        this.holdFace(false); this.clearPlayerTimers(player); this.render();
        const session = this.session || player.session;
        this.session = null; player.session = null;
        Promise.resolve().then(() => session ? session.stop('restart') : null).then(result => {
            if (result && result.confirmed === false) throw Error('teardown_unconfirmed');
            if (this.leaving || generation !== this.playGeneration || this.state.player !== player) return;
            this.startPlayer(at);
            if (this.state.player) { this.state.player.statusCode = 'reconnecting'; this.state.player.statusText = 'Reconnecting once…'; this.render(); }
        }).catch(() => { if (this.state.player === player) this.playbackFailed(player, null, 'teardown_unconfirmed'); });
    }
    endPlayer(player) {
        if (!player || player.ended) return;
        this.clearPlayerTimers(player);
        player.ended = true; player.endedAt = Date.now(); player.position = player.duration; player.paused = false;
        player.controlsVisible = true;
        if (player.loop) { this.startPlayer(0); return; }
        player.autoplayIn = player.autoplay && player.nextItem ? 8 : 0;
        if (this.state.details && this.state.details.video) this.store.watched(Object.assign(this.currentItem() || itemFor(this.state.details.video), { duration: player.duration }), player.duration);
        this.stopVideo('ended');
        this.dropOverlay();
        this.render();
    }
    replay() {
        const player = this.state.player;
        if (!player || this.playerStarting()) return;
        this.playbackRecovery = null;
        player.ended = false; player.endedAt = 0; player.autoplayIn = 0;
        this.startPlayer(0);
    }
    cancelAutoplay() {
        const player = this.state.player;
        if (!player) return;
        player.autoplay = false; player.autoplayIn = 0;
        this.touchControls(true);
        this.render();
    }
    // Leaving the player returns to its video's details; nothing is lost.
    playerBack() {
        const player = this.state.player;
        this.clearPlayerTimers(player);
        if (player && this.state.details) this.store.watched(Object.assign(this.currentItem() || itemFor(this.state.details.video), { duration: player.duration }), this.playerPosition(player));
        this.stopVideo('user');
        this.state.player = null; this.dropOverlay();
        this.state.screen = 'details';
        this.state.status = null;
        if (this.state.detailId) this.state.resumePosition = this.resumeFor(this.state.detailId, this.state.details && this.state.details.video);
        this.render();
    }
    // From the finished screen: the next video's details replace this one.
    playNext() {
        const player = this.state.player;
        if (player && player.nextItem) this.openVideoById(player.nextItem.id, player.nextItem, true, true);
    }

    skipSponsor(player) {
        if (!player || player.paused || player.ended || player.starting) return;
        const at = player.position;
        const segments = player.segments || [];
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            // Playback starts on a keyframe, which can be just before the
            // requested time: a segment ending where this start was aimed has
            // already been skipped, and skipping it again would loop forever.
            if (segment.end <= (player.skipFloor || 0) + 0.5) continue;
            if (at >= segment.start && at < segment.end - 0.25) {
                this.toast('SponsorBlock skipped');
                this.seekToTime(segment.end, true);
                return;
            }
        }
    }

    // A playback problem returns to the video's details, which show what
    // happened and the one next step (state.prepare + state.status).
    playbackFailed(player, message, code) {
        if (!this.state || this.state.player !== player) return;
        this.clearPlayerTimers(player);
        const at = this.playerPosition(player);
        if (this.state.details) this.store.watched(Object.assign(this.currentItem() || itemFor(this.state.details.video), { duration: player.duration }), at);
        this.state.resumePosition = at;
        this.stopVideo('playback_failed');
        this.state.player = null; this.dropOverlay();
        this.state.screen = 'details';
        this.state.status = this.statusFor(typeof code === 'object' ? code : { code: code || 'playback_failed' });
        this.state.prepare = { id: this.state.detailId, state: 'error', stage: 'play', reason: this.state.status.code, message: this.state.status.body };
        this.render();
    }

    updatePlayer() {
        const player = this.state.player;
        if (!player) return;
        if (this.playbackStartedMono != null && monotonic() - this.playbackStartedMono >= SESSION_LIMIT_MS) { this.playbackFailed(player, null, 'session_limit'); return; }
        if (!player.paused && !player.ended && !player.starting) {
            player.position = this.playerPosition(player);
            if (player.position >= player.duration - 0.35) { this.endPlayer(player); return; }
        }
        if (player.ended) {
            if (player.autoplay && player.nextItem) {
                player.autoplayIn = Math.max(0, Math.ceil(8 - (Date.now() - player.endedAt) / 1000));
                if (player.autoplayIn <= 0) { this.playNext(); return; }
            }
        }
        if (player.toast && Date.now() > player.toastUntil) player.toast = '';
        if (player.ended) { this.render(); return; }
        this.updateCaption(player);
        this.skipSponsor(player);
        if (player.controlsVisible && !player.settingsOpen && !player.paused && !player.starting &&
            Date.now() - (player.controlsAt || 0) > 5000) this.hideControls();
        if (player.session && Date.now() - (player.lastStatus || 0) > 2000) { player.lastStatus = Date.now(); player.session.status(); }
        if (this.overlay && player.session) this.overlay.update(player.session, player, false);
    }

    tick(generation) {
        if (this.faceHeld && (!this.session || !this.state || this.state.screen !== 'player')) this.holdFace(false);
        if (!this.opened || this.leaving || generation !== this.generation) return;
        if (this.store && this.store.lastError && !this.state.storageWarning) { this.state.storageWarning = 'storage_unavailable'; this.toast(this.statusFor({ code: 'storage_unavailable' }).body); }
        else if (this.store && !this.store.lastError) this.state.storageWarning = null;
        if (this.state.screen === 'voice') {
            this.render(); return;
        }
        if (this.state.screen === 'player') { this.updatePlayer(); this.syncPlayerHitAreas(); return; }
        if (Date.now() - this.lastRender > 900) this.render();
    }

    voice() {
        if (this.state.screen === 'voice') { this.cancelVoice(true); return; }
        const generation = this.generation, jetstream = jibo.jetstream;
        if (!jetstream || typeof jetstream.startLocalTurn !== 'function') { this.toast('Voice search is not available'); return; }
        this.state.screen = 'voice'; this.state.voiceText = 'Say what you want to watch';
        this.render();
        this.startVoiceTimer();
        const options = { nluRules: ['launch'], ignoreGlobalRules: true, sosTimeout: 7, maxSpeechTimeout: 15,
            hintPhrases: ['search', 'music', 'gaming', 'news', 'trailer', 'how to', 'comedy'] };
        Promise.resolve(jetstream.startLocalTurn(options)).then(request => {
            if (generation !== this.generation || !this.opened || this.leaving || this.state.screen !== 'voice') { try { request.cancel(); } catch (_) {} return; }
            this.voiceRequest = request;
            return request.promise;
        }).then(result => {
            this.stopVoiceTimer();
            this.voiceRequest = null;
            if (generation !== this.generation || !this.opened || this.leaving || this.state.screen !== 'voice') return;
            const asr = result && (result.asr || (result.result && result.result.asr));
            const text = asr && typeof asr.text === 'string' ? asr.text.trim() : '';
            if (!text) {
                this.state.screen = 'search'; this.state.status = null;
                this.toast('I did not catch that. Try again?'); return;
            }
            this.state.query = text.slice(0, 120);
            this.state.screen = 'search';
            this.render();
            this.search();
        }).catch(() => {
            this.stopVoiceTimer();
            this.voiceRequest = null;
            if (generation !== this.generation || !this.opened || this.leaving || this.state.screen !== 'voice') return;
            this.state.screen = 'search';
            this.toast('Voice search is unavailable right now');
        });
    }
    startVoiceTimer() {
        this.stopVoiceTimer();
        this.voiceTimer = timers.setInterval(() => { if (this.state.screen === 'voice') this.render(); }, 120);
    }
    stopVoiceTimer() {
        if (this.voiceTimer) { timers.clearInterval(this.voiceTimer); this.voiceTimer = null; }
    }
    cancelVoice(goBack) {
        this.stopVoiceTimer();
        const request = this.voiceRequest; this.voiceRequest = null;
        if (request) { try { request.cancel(); } catch (_) {} }
        if (this.state && this.state.screen === 'voice' && goBack !== false) {
            this.state.screen = 'search'; this.state.status = null;
            this.render();
        }
    }

    // Clear history asks first, on its own panel with Clear and Keep buttons
    // in a different place. Clear only works after a short pause, so the
    // second tap of a double tap cannot clear by accident.
    clearHistory() {
        if (this.state.libConfirm) return;
        this.state.libConfirm = true; this.state.libConfirmAt = Date.now();
        this.render();
        const generation = this.generation;
        if (this.libConfirmTimer) timers.clearTimeout(this.libConfirmTimer);
        this.libConfirmTimer = timers.setTimeout(() => { this.libConfirmTimer = null; if (generation === this.generation && this.state && this.state.libConfirm) this.render(); }, 650);
    }
    confirmClearHistory() {
        if (!this.state.libConfirm || Date.now() - (this.state.libConfirmAt || 0) < 600) return;
        this.state.libConfirm = false;
        this.store.clearHistory();
        this.state.library = { history: [], likes: this.store.state.likes.slice() };
        this.toast('Watch history cleared');
        this.openLibrary();
    }
    cancelClearHistory() {
        if (!this.state.libConfirm) return;
        this.state.libConfirm = false;
        this.render();
    }
    // The full-screen problem's one button: Try again (only if retryable),
    // Back, or Close JiboTube.
    statusAction() {
        const f = this.ui && this.ui.frame;
        const action = f && f.status ? f.status.action : '';
        if (action === 'close') { this.leave(this.generation); return; }
        if (action === 'back') { this.state.status = null; this.back(); return; }
        if (action === 'retry' && this.state.screen === 'error') this.retry();
    }

    leave(generation) {
        if (generation !== this.generation || this.leaving) return;
        this.leaving = true;
        this.cancelVoice(false);
        this.stopVoiceTimer();
        this.stopVideo('leave');
        this.exit({ noElementsOfSurprise: true });
    }

    close(done) {
        if (this.closing) {
            if (this.closing.finished) done(this.closing.error);
            else this.closing.callbacks.push(done);
            return;
        }
        this.generation++; this.opened = false; this.leaving = true;
        if (this.client) this.client.close();
        this.cancelVoice(false); this.stopVoiceTimer();
        this.events.forEach(off => { try { off(); } catch (_) {} }); this.events = [];
        if (this.tickTimer) { timers.clearInterval(this.tickTimer); this.tickTimer = null; }
        this.stopBusyTimer();
        if (this.libConfirmTimer) { timers.clearTimeout(this.libConfirmTimer); this.libConfirmTimer = null; }
        if (this.volumeApplyTimer) { timers.clearTimeout(this.volumeApplyTimer); this.volumeApplyTimer = null; }
        if (this.volumeRetryTimer) { timers.clearTimeout(this.volumeRetryTimer); this.volumeRetryTimer = null; }
        if (this.state && this.state.player) this.clearPlayerTimers(this.state.player);
        this.volumeTarget = null;
        const closing = this.closing = { callbacks: [done], finished: false, error: null };
        const view = this.view, views = jibo.face && jibo.face.views, ui = this.ui;
        const errors = [];
        const attempt = work => Promise.resolve().then(work).catch(error => { errors.push(error); });
        // Every owned cleanup is attempted, even if an earlier one failed.
        // Failure is preserved; a removed view is not proof a child exited.
        Promise.all([attempt(() => this.stopVideo('close')), attempt(() => video.shutdown()), attempt(() => ServiceModule.stop())]).then(() => {
            this.holdFace(false); this.dropOverlay();
            try { if (ui) ui.releaseArt(); } catch (error) { errors.push(error); }
            lifecycle.closeView(views, jibo.face && jibo.face.tween, view, timers, 'jibotube', error => {
                closing.finished = true; closing.error = errors[0] || error || null;
                if (!error) { this.view = null; this.ui = null; }
                const callbacks = closing.callbacks; closing.callbacks = [];
                callbacks.forEach(callback => callback(closing.error));
            });
        }).catch(error => {
            this.holdFace(false); this.dropOverlay();
            closing.finished = true; closing.error = errors[0] || error;
            const callbacks = closing.callbacks; closing.callbacks = [];
            callbacks.forEach(callback => callback(closing.error));
        });
    }
    destroy(done) { this.close(error => super.destroy(baseError => done(error || baseError))); }
}

module.exports = JiboTubeSkill;
