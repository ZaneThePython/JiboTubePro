'use strict';

const jibo = require('jibo');
const timers = require('timers');
const FACE_HELD_MS = 250;
const BeSkill = require('@be/be-framework').BeSkill;
const lifecycle = require('./touch-lifecycle');
const video = require('./video');
const ClientModule = require('./client');
const ServiceModule = require('./service');
const StoreModule = require('./store');
const UI = require('./ui').UI;
const Overlay = require('./overlay').Overlay;
const diagnostics = require('./diagnostics');

const MAX_HOME_ROWS = 9;

function itemFor(item) {
    return { id: item.id, title: item.title, channel: item.channel || '', duration: Number(item.duration) || 0,
        music: !!(item && item.music) };
}
function statusOf(error) {
    const code = error && (error.code || error.message) || 'unknown';
    if (code === 'unauthorized') return 'The companion service token is wrong.';
    if (code === 'timeout') return 'The companion service did not answer.';
    return 'The companion service is not reachable.';
}

class JiboTubeSkill extends BeSkill {
    constructor() {
        super(...arguments);
        this.generation = 0; this.pageRequestId = 0; this.view = null; this.ui = null; this.client = null; this.store = null;
        this.events = []; this.closing = null; this.leaving = false; this.opened = false;
        this.session = null; this.overlay = null; this.playGeneration = 0; this.tickTimer = null; this.voiceTimer = null;
        this.lastRender = 0; this.libConfirmTimer = null; this.voiceRequest = null;
        this.state = null;
    }

    preload(done) {
        try { ServiceModule.settings(); done(); } catch (error) { done(error); }
    }

    open() {
        if (this.view) return;
        const generation = ++this.generation, views = jibo.face && jibo.face.views;
        this.closing = null; this.leaving = false; this.opened = false;
        if (!views || !views.createView || !views.changeView || !global.PIXI) { this.exit({ noElementsOfSurprise: true }); return; }
        this.store = new StoreModule.Store();
        const settings = ServiceModule.settings();
        this.client = new ClientModule.Client(settings);
        this.state = {
            screen: 'loading', tab: 'home', loading: true, status: null, query: '', symbols: false,
            recentSearches: this.store.state.searches.slice(0, 4), home: null, homeTop: 0, shelfOffsets: {},
            results: null, resultsPage: 0, details: null, relatedPage: 0, liked: false, thumbUrl: '', prepare: null,
            pendingPlay: false, resumePosition: 0, detailId: '', previous: 'home',
            library: { history: this.store.state.history, likes: this.store.state.likes }, libConfirm: false,
            player: null, voiceText: '', toast: '', toastAt: 0, railStatus: 'NO ADS',
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
                if (!this.client.configured()) { this.fail('JiboTube could not start', 'Close JiboTube and try again.'); return; }
                const current = this.pageRequest();
                ServiceModule.ensure(this.client.settings).then(ok => {
                    if (!current()) return;
                    if (!ok) { this.fail('JiboTube could not start', 'Close JiboTube and try again.'); return; }
                    this.loadHome(generation);
                });
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
            replay: call('replay'), cancelAutoplay: call('cancelAutoplay'), playerBack: call('playerBack'),
            statusAction: call('statusAction'), volumeUp: call('volumeUp'), volumeDown: call('volumeDown'),
            screenTap: call('screenTap'), toggleSettings: call('toggleSettings'), closeSettings: call('closeSettings'),
            toggleCaptions: call('toggleCaptions'), setLoop: call('setLoop'),
            setAutoplay: call('setAutoplay'),
            setSearchMode: call('setSearchMode'), musicSearchOpen: call('musicSearchOpen')
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
        if (this.ui && this.view && this.view.state !== 'destroyed') this.ui.render(this.state);
    }
    // Player controls are drawn as video layers, but taps hit-test the PIXI
    // buttons under them, whose visibility only ui.render sets. Re-render
    // whenever what is tappable changes, or settings chips stay unreachable
    // and taps fall through to the buttons beneath.
    syncPlayerHitAreas() {
        const player = this.state.player;
        const key = player ? [player.generation, player.controlsVisible, player.settingsOpen, player.ended, !!player.session, player.starting].join('|') : '';
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
        this.state.toast = text; this.state.toastAt = Date.now();
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

    fail(title, body) {
        this.state.loading = false; this.state.screen = 'error';
        this.state.status = { title: title, body: body, action: 'Try again' };
        this.render();
    }
    retry() {
        const generation = this.generation, current = this.pageRequest();
        this.state.status = null; this.state.screen = 'loading';
        ServiceModule.ensure(this.client.settings).then(() => {
            if (!current()) return;
            this.loadHome(generation);
        });
    }

    pageRequest() {
        const generation = this.generation, request = ++this.pageRequestId;
        return () => generation === this.generation && request === this.pageRequestId && !this.leaving;
    }

    loadHome(generation) {
        if (!this.active(generation) && this.opened) return;
        const current = this.pageRequest();
        this.state.loading = true; this.state.screen = 'loading';
        this.state.status = { title: 'Loading JiboTube', body: 'Finding something good…' };
        this.render();
        this.client.home(this.store.payload()).then(home => {
            if (!current()) return;
            this.state.home = this.enrichHome(home);
            this.state.loading = false; this.state.status = null; this.state.screen = 'home'; this.state.tab = 'home';
            this.state.emptyText = '';
            this.render();
        }).catch(error => {
            if (!current()) return;
            this.fail('Could not reach JiboTube', statusOf(error));
        });
    }

    loadMusicHome(generation) {
        if (!this.active(generation) && this.opened) return;
        const current = this.pageRequest();
        this.state.loading = true; this.state.screen = 'loading';
        this.state.status = { title: 'Loading music', body: 'Finding songs and artists…' };
        this.render();
        this.client.musicHome(this.store.payload()).then(home => {
            if (!current()) return;
            this.state.musicHome = this.enrichHome(home);
            this.state.musicLoaded = true;
            this.state.loading = false; this.state.status = null;
            this.state.screen = 'music'; this.state.tab = 'music';
            this.render();
        }).catch(error => {
            if (!current()) return;
            this.fail('Could not load music', statusOf(error));
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

    nav(tab) {
        this.pageRequestId++; this.state.loading = false;
        this.cancelVoice(false);
        this.stopVideo('nav');
        this.state.player = null; this.dropOverlay();
        if (tab === 'home') {
            this.state.tab = 'home';
            if (this.state.home) { this.state.screen = 'home'; this.state.status = null; this.render(); }
            else this.loadHome(this.generation);
        } else if (tab === 'music') {
            this.state.tab = 'music';
            if (this.state.musicHome) { this.state.screen = 'music'; this.state.status = null; this.render(); }
            else this.loadMusicHome(this.generation);
        } else if (tab === 'trending') {
            this.state.tab = 'trending';
            this.showTrending();
        } else if (tab === 'search') {
            this.state.tab = 'search'; this.state.screen = 'search'; this.state.status = null; this.render();
        } else if (tab === 'library') {
            this.state.tab = 'library'; this.openLibrary();
        }
    }

    showTrending() {
        const current = this.pageRequest();
        const row = this.state.home && this.state.home.rows.filter(item => item.id === 'trending')[0];
        if (row) {
            this.state.previous = 'home';
            this.state.results = { title: 'Trending now', items: row.items.slice(), back: true };
            this.state.resultsPage = 0; this.state.screen = 'results'; this.state.status = null;
            this.render();
            return;
        }
        this.state.loading = true; this.state.screen = 'loading';
        this.state.status = { title: 'Loading trending', body: 'Checking what is popular…' };
        this.render();
        this.client.search('trending now').then(result => {
            if (!current()) return;
            this.state.results = { title: 'Trending now', items: result.items.map(item => this.enrich(item, 'mqdefault')), back: true };
            this.state.resultsPage = 0; this.state.loading = false; this.state.status = null; this.state.screen = 'results';
            this.render();
        }).catch(error => { if (current()) this.fail('Could not load trending', statusOf(error)); });
    }

    openLibrary() {
        this.pageRequestId++; this.state.loading = false;
        this.state.library = { history: this.store.state.history.map(item => this.enrich(item, 'mqdefault')),
            likes: this.store.state.likes.map(item => this.enrich(item, 'mqdefault')) };
        this.state.screen = 'library'; this.state.status = null;
        this.render();
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
        this.pageRequestId++; this.state.loading = false;
        const shelf = this.shelves()[s];
        if (!shelf) return;
        this.state.previous = this.state.screen;
        this.state.results = { title: shelf.row.title, items: shelf.row.items.slice(), back: true };
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
        if (this.state.screen === 'results' && this.state.query) this.search();
        else this.render();
    }
    musicSearchOpen() {
        this.pageRequestId++; this.state.loading = false;
        this.state.searchMode = 'music';
        this.state.tab = 'search';
        this.state.screen = 'search';
        this.state.query = '';
        this.state.status = null;
        this.render();
    }
    search() {
        const query = String(this.state.query || '').trim();
        if (!query) { this.toast('Type something to search'); return; }
        const current = this.pageRequest();
        const music = this.state.searchMode === 'music';
        this.store.search(query);
        this.state.recentSearches = this.store.state.searches.slice(0, 4);
        this.state.previous = 'search';
        this.state.results = { title: '“' + query + '”', items: [], back: true, sub: 'Searching…', music: music };
        this.state.resultsPage = 0; this.state.screen = 'results'; this.state.loading = true;
        this.render();
        const request = music ? this.client.musicSearch(query) : this.client.search(query);
        request.then(result => {
            if (!current() || this.state.screen !== 'results' || this.state.results.title !== '“' + query + '”') return;
            this.state.results = { title: '“' + query + '”', items: (result.items || []).map(item => this.enrich(item, 'mqdefault')),
                back: true, sub: music ? 'Music' : '', music: music || !!result.music };
            this.state.loading = false;
            this.render();
        }).catch(error => {
            if (!current()) return;
            this.state.loading = false;
            this.state.results = { title: '“' + query + '”', items: [], back: true, sub: music ? 'Music' : '', music: music };
            this.toast(statusOf(error));
        });
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
    back() {
        this.pageRequestId++; this.state.loading = false;
        if (this.state.screen === 'player') { this.playerBack(); return; }
        this.cancelVoice(false);
        if (this.state.screen === 'details') {
            this.stopVideo('back');
            this.state.player = null; this.dropOverlay();
            this.state.screen = this.state.previous || 'home';
            this.state.status = null;
            this.render();
            return;
        }
        if (this.state.screen === 'results') {
            this.state.screen = this.state.previous === 'search' ? 'search' : 'home';
            this.state.status = null;
            this.render();
            return;
        }
        this.state.screen = 'home'; this.state.tab = 'home'; this.state.status = null;
        this.render();
    }

    openVideoById(id, item, autoplay) {
        if (!id) return;
        const current = this.pageRequest();
        this.state.loading = false;
        this.cancelVoice(false);
        this.stopVideo('open');
        this.state.previous = this.state.screen === 'player' ? 'details' : this.state.screen;
        if (this.state.previous === 'voice') this.state.previous = 'search';
        this.state.detailId = id; this.state.relatedPage = 0; this.state.liked = this.store.liked(id);
        this.state.captions = []; this.state.captionsFor = '';
        this.state.detailsMusic = !!(item && item.music) || this.state.tab === 'music' || this.state.searchMode === 'music';
        const known = item || { id: id, title: 'Loading video…', channel: '', duration: 0 };
        this.state.details = { video: this.enrich(known, 'hq720'), related: [], rows: [], sponsor: { enabled: true, segments: [] } };
        this.state.thumbUrl = this.client.thumb(known, 'hq720');
        this.state.prepare = null; this.state.pendingPlay = !!autoplay;
        const history = this.store.state.history.filter(entry => entry.id === id)[0];
        this.state.resumePosition = history && history.position < (known.duration || 86400) - 15 ? history.position : 0;
        this.state.screen = 'details'; this.state.status = null;
        this.state.player = null; this.dropOverlay();
        this.render();
        this.client.video(id).then(details => {
            if (!current() || this.state.detailId !== id) return;
            details.video = this.enrich(details.video, 'hq720');
            details.related = (details.related || []).map(related => this.enrich(related, 'mqdefault'));
            details.rows = (details.rows || []).map(row => Object.assign({}, row, { items: (row.items || []).map(related => this.enrich(related, 'mqdefault')) }));
            this.state.details = details;
            this.state.thumbUrl = details.video.thumbUrl;
            this.state.liked = this.store.liked(id);
            this.state.prepare = { id: id, state: 'ready', cleanDuration: details.video.duration || 0 };
            const historyItem = this.store.state.history.filter(entry => entry.id === id)[0];
            this.state.resumePosition = historyItem && historyItem.position < (details.video.duration || 86400) - 15 ? historyItem.position : 0;
            if (this.state.pendingPlay) { this.state.pendingPlay = false; this.startPlayer(this.state.resumePosition || 0); return; }
            this.render();
        }).catch(error => {
            if (!current() || this.state.detailId !== id) return;
            this.state.pendingPlay = false;
            if (autoplay) {
                this.state.screen = 'home'; this.state.tab = 'home'; this.state.player = null;
                this.toast('Skipped an unavailable video');
                this.render();
                return;
            }
            this.toast('Could not load this video');
        });
    }

    play() {
        if (!this.state.details) return;
        this.state.pendingPlay = false;
        this.startPlayer(this.state.resumePosition || 0);
    }
    like() {
        const videoItem = this.state.details && this.state.details.video;
        if (!videoItem) return;
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
        const segments = (details.sponsor && details.sponsor.segments) || [];
        const next = (details.related && details.related[0]) || null;
        let target = Math.max(0, Math.min(Math.max(0, (Number(v.duration) || 0) - 1), Number(position) || 0));
        for (let i = 0; i < segments.length; i++) {
            if (target >= segments[i].start && target < segments[i].end) { target = segments[i].end; snapAfter = true; break; }
        }
        this.stopVideo('restart');
        const generation = ++this.playGeneration;
        const player = this.state.player = {
            id: v.id, title: v.title, channel: v.channel || '', duration: Number(v.duration) || 0,
            base: target, position: target, startedAt: 0, paused: false, starting: true, ended: false, endedAt: 0,
            autoplay: this.store.state.settings.autoplay !== false, autoplayIn: 0, nextItem: next,
            sponsorCount: segments.length, segments: segments, nextTitle: next ? next.title : '',
            statusText: 'Buffering…', toast: '', toastUntil: 0, generation: generation, volume: this.volumeLevel(),
            overlayRecoveries: 0, lastStatus: 0, serviceRetried: !!serviceRetried, skipFloor: target, snapAfter: !!snapAfter,
            loop: this.store.state.settings.loop === true, captionsOn: this.store.state.settings.captions === true,
            captionsAvailable: this.state.captionsFor === v.id && this.state.captions.length > 0,
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
            player.statusText = 'Starting…';
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
                videoMime: info.videoMime, audioMime: info.audioMime, audio: !!info.audio, stage: this.view && this.view.stage, duration: Math.max(0, player.duration - player.base)
            });
            player.session = session;
            this.overlay.update(session, player, true);
            this.store.watched(Object.assign(this.currentItem() || itemFor(v), { duration: player.duration }), player.base);
            session.on('state', event => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                if (event.state === 'visible') {
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
                    if (!player.startedAt) { player.startedAt = Date.now(); }
                    this.overlay.update(session, player, true);
                } else if (event.state === 'buffering') {
                    player.starting = true; player.statusText = 'Buffering…';
                    if (this.overlay) this.overlay.update(session, player, true);
                } else if (event.state === 'ended') {
                    this.endPlayer(player);
                } else if (event.state === 'stopped') {
                    this.holdFace(false);
                    player.session = null;
                    if (this.session === session) this.session = null;
                    if (this.state.player !== player) return;
                    if (/^interrupted/.test(event.reason || '')) { this.leave(this.generation); return; }
                    if (/^restart|request$/.test(event.reason || '')) return;
                    if (event.error && (player.starting || event.reason !== 'player_exit')) { this.playbackFailed(player, diagnostics.message(event.error)); return; }
                    if (event.reason === 'player_exit') { this.playerExited(player); return; }
                    if (event.reason === 'host_exit' || event.reason === 'play_error') { this.playbackFailed(player, 'Playback stopped'); return; }
                    if (!player.ended && !player.paused) { player.paused = true; player.position = this.playerPosition(player); this.overlay.update(session, player, true); }
                }
            });
            session.on('error', event => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                // A transient branch error (for example the audio socket) should
                // not tear down a video that is still playing.
                if (!player.errorHandled) {
                    player.errorHandled = true;
                    player.lastError = event;
                    player.toast = diagnostics.message(event);
                    player.toastUntil = Date.now() + 4000;
                }
                if (this.overlay) this.overlay.update(session, player, true);
            });

        }).catch(error => {
            if (generation !== this.playGeneration || this.state.player !== player) return;
            // The service answered but cannot stream this video (for example a
            // just-ended live stream, which YouTube serves without an index).
            if (error && error.code === 'stream_unavailable') { this.playbackFailed(player, "This video can't be played on Jibo"); return; }
            if (player.serviceRetried) { this.playbackFailed(player, 'Could not start playback'); return; }
            player.serviceRetried = true;
            player.statusText = 'Starting the local service…';
            this.render();
            ServiceModule.ensure(this.client.settings).then(ok => {
                if (generation !== this.playGeneration || this.state.player !== player) return;
                if (ok) this.startPlayer(target, true, snapAfter);
                else this.playbackFailed(player, 'Could not start playback');
            });
        });
    }
    playerPosition(player) {
        if (player.paused || player.ended) return Math.max(0, Math.min(player.duration, player.position || 0));
        if (player.session && typeof player.session.position === 'function') return Math.max(0, Math.min(player.duration, player.base + player.session.position()));
        if (!player.startedAt) return player.base || 0;
        return Math.max(0, Math.min(player.duration, (player.base || 0) + (Date.now() - player.startedAt) / 1000));
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
        if (!player || !player.controlsVisible || player.settingsOpen || player.paused || player.ended) return;
        // No intermediate fade frame: each one redrew every control layer.
        player.controlsAlpha = 1; player.controlsVisible = false;
        if (this.overlay && player.session) this.overlay.update(player.session, player, false);
        this.syncPlayerHitAreas();
    }
    screenTap() {
        const player = this.state.player;
        if (!player) return;
        if (player.settingsOpen) { this.closeSettings(); return; }
        if (!player.controlsVisible) { this.showControls(); return; }
        this.togglePlay();
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

    // The face renderer redraws its stage every frame even under a fullscreen
    // video, about half a CPU core the decoder needs on a busy robot. Playback
    // pauses it; stopVideo (every teardown) and a per-tick check restore it.
    // It still ticks at FACE_HELD_MS so touch hit-testing (which uses the
    // transforms an update computes), gestures and tweens keep working: a full
    // pause left controls that appear during playback unreachable.
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
        if (!player) return;
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
    }
    resumePlayer() {
        const player = this.state.player;
        if (!player || !player.paused) return;
        player.paused = false; player.statusText = 'Resuming…';
        if (player.session) { player.session.show(); }
        else { this.startPlayer(player.position); }
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
        if (!player) return;
        player.position = position; player.paused = false; player.starting = true; player.ended = false;
        player.statusText = 'Seeking…';
        this.startPlayer(position, false, snapAfter);
    }
    next() {
        const player = this.state.player;
        if (!player) return;
        if (player.nextItem) this.openVideoById(player.nextItem.id, player.nextItem, true);
        else this.toast('No next video');
    }
    // The player also exits when its stream breaks off. Only an exit near the
    // end is the end; otherwise reconnect once at the current position (not
    // again within 30 s), so a hiccup never skips to the next video.
    playerExited(player) {
        const at = this.playerPosition(player);
        if (!player.duration || at >= player.duration - 10) { this.endPlayer(player); return; }
        const last = this.lastRecovery;
        if (player.starting || (last && last.id === player.id && Date.now() - last.at < 30000)) {
            this.playbackFailed(player, player.lastError ? diagnostics.message(player.lastError) : 'Playback stopped');
            return;
        }
        this.lastRecovery = { id: player.id, at: Date.now() };
        this.startPlayer(at);
        if (this.state.player) { this.state.player.statusText = 'Reconnecting…'; this.render(); }
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
        if (!player) return;
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
    playerBack() {
        const player = this.state.player;
        this.clearPlayerTimers(player);
        if (player && this.state.details) this.store.watched(Object.assign(this.currentItem() || itemFor(this.state.details.video), { duration: player.duration }), this.playerPosition(player));
        this.stopVideo('user');
        this.state.player = null; this.dropOverlay();
        this.state.screen = 'details';
        this.state.status = null;
        this.render();
    }
    playNext() {
        const player = this.state.player;
        if (player && player.nextItem) this.openVideoById(player.nextItem.id, player.nextItem, true);
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

    playbackFailed(player, message) {
        if (!this.state || this.state.player !== player) return;
        this.clearPlayerTimers(player);
        this.stopVideo('playback_failed');
        this.state.player = null; this.dropOverlay();
        this.state.screen = 'details';
        this.toast(message || 'Playback stopped');
        this.render();
    }

    updatePlayer() {
        const player = this.state.player;
        if (!player) return;
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
            Date.now() - (player.controlsAt || 0) > 4000) this.hideControls();
        if (player.session && Date.now() - (player.lastStatus || 0) > 2000) { player.lastStatus = Date.now(); player.session.status(); }
        if (this.overlay && player.session) this.overlay.update(player.session, player, false);
    }

    tick(generation) {
        if (this.faceHeld && (!this.session || !this.state || this.state.screen !== 'player')) this.holdFace(false);
        if (!this.opened || this.leaving || generation !== this.generation) return;
        if (this.state.screen === 'voice') {
            this.render(); return;
        }
        if (this.state.screen === 'player') { this.updatePlayer(); this.syncPlayerHitAreas(); return; }
        if (Date.now() - this.lastRender > 900) this.render();
        if (this.state.libConfirm && !this.libConfirmTimer) {
            this.libConfirmTimer = timers.setTimeout(() => { this.libConfirmTimer = null; this.state.libConfirm = false; this.render(); }, 3500);
        }
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

    clearHistory() {
        if (!this.state.libConfirm) {
            this.state.libConfirm = true;
            this.render();
            return;
        }
        this.state.libConfirm = false;
        this.store.clearHistory();
        this.state.library = { history: [], likes: this.store.state.likes.slice() };
        this.toast('History cleared');
        this.render();
    }
    statusAction() {
        if (this.state.screen === 'error') this.retry();
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
        if (this.libConfirmTimer) { timers.clearTimeout(this.libConfirmTimer); this.libConfirmTimer = null; }
        if (this.volumeApplyTimer) { timers.clearTimeout(this.volumeApplyTimer); this.volumeApplyTimer = null; }
        if (this.volumeRetryTimer) { timers.clearTimeout(this.volumeRetryTimer); this.volumeRetryTimer = null; }
        if (this.state && this.state.player) this.clearPlayerTimers(this.state.player);
        this.volumeTarget = null;
        const closing = this.closing = { callbacks: [done], finished: false, error: null };
        const view = this.view, views = jibo.face && jibo.face.views, ui = this.ui;
        this.stopVideo('close').then(() => Promise.all([video.shutdown(), ServiceModule.stop()])).then(() => {
            this.dropOverlay();
            if (ui) ui.releaseArt();
            lifecycle.closeView(views, jibo.face && jibo.face.tween, view, timers, 'jibotube', error => {
                closing.finished = true; closing.error = error;
                if (!error) { this.view = null; this.ui = null; }
                const callbacks = closing.callbacks; closing.callbacks = [];
                callbacks.forEach(callback => callback(error));
            });
        }).catch(error => {
            this.holdFace(false); this.dropOverlay();
            closing.finished = true; closing.error = error;
            const callbacks = closing.callbacks; closing.callbacks = [];
            callbacks.forEach(callback => callback(error));
        });
    }
    destroy(done) { this.close(error => super.destroy(baseError => done(error || baseError))); }
}

module.exports = JiboTubeSkill;
