'use strict';
const assert = require('assert'), EventEmitter = require('events');
const uiModule = require('../ui'), overlayModule = require('../overlay');
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise: promise, resolve: resolve }; }
function flush() { let promise = Promise.resolve(); for (let i = 0; i < 10; i++) promise = promise.then(() => {}); return promise; }
module.exports = function (load) {
    const P = overlayModule.PLAYER, ui = new uiModule.UI({ allowed: () => true });
    ui.config({ ActionData: { CALLBACK: 'callback' } });
    assert.deepStrictEqual(uiModule.BACK, P.back);
    const geometry = { pBack: 'back', pBack10: 'back10', pToggle: 'play', pFwd10: 'fwd10', pCaptions: 'captions', pSettings: 'settings', pNext: 'next', pVolDown: 'volDown', pVolUp: 'volUp', pResume: 'pausedCard' };
    Object.keys(geometry).forEach(id => {
        const control = ui.byId[id], rect = P[geometry[id]];
        assert.deepStrictEqual([control.x, control.y, control.w, control.h], [rect.x, rect.y, rect.w, rect.h]);
    });
    const row = ['back10', 'play', 'fwd10', 'captions', 'volDown', 'volUp', 'settings', 'next'];
    row.forEach((id, i) => {
        assert(P[id].w >= 88 && P[id].h >= 88);
        assert.strictEqual(P[id].y, 612);
        if (i) assert(P[row[i - 1]].x + P[row[i - 1]].w <= P[id].x);
    });
    const uiState = { screen: 'player', player: { starting: true, controlsVisible: true, nextTitle: 'Next' } };
    ui.frame = ui.compute(uiState);
    assert(ui.visible(ui.byId.pBack));
    ['pToggle', 'pScreenTap', 'pFwd10', 'pSettings', 'pNext'].forEach(id => assert(!ui.visible(ui.byId[id]), id + ' stays hidden during startup'));
    uiState.player.starting = false; uiState.player.paused = true; uiState.player.controlsVisible = false;
    ui.frame = ui.compute(uiState); assert(ui.visible(ui.byId.pResume)); assert(ui.visible(ui.byId.pToggle));
    const drawn = [], ctx = { fillText: value => drawn.push(value) };
    ['clearRect', 'fillRect', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'closePath'].forEach(name => { ctx[name] = () => {}; });
    overlayModule.Overlay.prototype.drawCenter.call({ center: { width: 520, height: 208, getContext: () => ctx }, layer: () => {} }, null, { paused: true });
    assert(drawn.indexOf('Paused') >= 0);
    [['timeout', 'Try again'], ['network_unavailable', 'Try again'], ['unsupported_format', 'Pick another video'], ['unavailable', 'Pick another video'], ['unauthorized', 'Close JiboTube']].forEach(pair => {
        assert.strictEqual(uiModule.statusInfo(pair[0], { context: 'details' }).label, pair[1]);
    });
    assert.strictEqual(uiModule.statusInfo({ code: 'timeout', retryable: false }, { context: 'details' }).action, 'back');

    class Session extends EventEmitter {
        constructor() { super(); this.at = 0; this.stopped = false; this.stopGate = null; }
        position() { return this.at; }
        status() {} pause() { this.paused = true; } show() { this.paused = false; }
        stop(reason) {
            this.stopped = true;
            this.emit('state', { state: 'stopped', reason: reason, position: this.at, error: this.error });
            return this.stopGate || Promise.resolve();
        }
        fail(reason) { this.error = { reason: reason }; this.emit('error', this.error); this.stop('play_error'); }
    }
    const sessions = [], requests = [];
    const Skill = load('index.js', {
        jibo: { face: {} }, '@be/be-framework': { BeSkill: class {} },
        './video': { open: options => { const session = new Session(); session.options = options; sessions.push(session); return session; } },
        './overlay': { Overlay: class { update() {} destroy() {} reset() {} } }
    });
    function create() {
        const skill = new Skill(); skill.render = () => {}; skill.active = () => true;
        skill.view = { stage: {} };
        skill.store = { state: { history: [], likes: [], settings: {}, searches: [] }, liked: () => false, payload: () => ({}),
            watched: (item, at) => { skill.store.state.history = [Object.assign({}, item, { position: at })]; } };
        skill.client = { stream: (id, at) => { requests.push(at); return Promise.resolve({ start: at, duration: 200, video: '/video', audio: '/audio', videoMime: 'video/mp4', audioMime: 'audio/mp4' }); }, streamUrl: p => 'http://localhost' + p,
            captions: () => Promise.resolve({ cues: [] }), thumb: () => '' };
        skill.state = { screen: 'details', tab: 'home', detailId: 'abcdefghijk', details: { loaded: true, video: { id: 'abcdefghijk', title: 'Test', duration: 200 }, related: [] },
            stack: [], captions: [], captionsFor: 'abcdefghijk', resumePosition: 12, query: 'test', searchMode: 'all', homeTop: 2, shelfOffsets: { row: 4 } };
        return skill;
    }
    const skill = create();
    skill.play(); skill.play(); skill.togglePlay(); skill.seek(10);
    assert.strictEqual(requests.length, 1, 'rapid startup taps queue one stream');
    return flush().then(() => {
        assert.strictEqual(sessions.length, 1); assert.strictEqual(sessions[0].options.videoMime, 'video/mp4');
        sessions[0].emit('state', { state: 'starting' });
        sessions[0].emit('state', { state: 'playing' }); sessions[0].at = 20;
        skill.pausePlayer(); assert(skill.state.player.paused); skill.resumePlayer();
        assert.strictEqual(sessions.length, 1, 'resume reuses the buffered session');
        const gate = deferred(); sessions[0].stopGate = gate.promise;
        skill.recoverPlayer(skill.state.player, 'playback_stalled');
        return flush().then(() => {
            assert(sessions[0].stopped); assert.strictEqual(sessions.length, 1, 'replacement waits for teardown');
            gate.resolve(); return flush();
        });
    }).then(() => {
        assert.strictEqual(sessions.length, 2); assert.strictEqual(requests[1], 32, 'recover from actual media position plus stream base');
        sessions[1].emit('state', { state: 'playing' }); sessions[1].at = 7;
        sessions[1].fail('playback_stalled');
        return flush();
    }).then(() => {
        assert.strictEqual(sessions.length, 2, 'automatic recovery budget is not replenished by successful playback');
        assert.strictEqual(skill.state.screen, 'details'); assert.strictEqual(skill.state.status.code, 'playback_stalled');
        assert.strictEqual(skill.state.resumePosition, 39);
        skill.play(); return flush();
    }).then(() => {
        assert.strictEqual(sessions.length, 3, 'explicit retry begins a new attempt');
        sessions[2].fail('media_4'); return flush();
    }).then(() => {
        assert.strictEqual(sessions.length, 3, 'unsupported codecs never auto-retry');
        assert.strictEqual(skill.state.status.code, 'unsupported_format');
        const cancelled = create(), pending = deferred(); cancelled.client.stream = () => pending.promise;
        cancelled.play(); cancelled.playerBack(); pending.resolve({ start: 0, video: '/video' });
        return flush().then(() => { assert.strictEqual(sessions.length, 3); assert.strictEqual(cancelled.state.screen, 'details'); });
    }).then(() => {
        const cancelled = create(); cancelled.play();
        return flush().then(() => {
            const session = sessions[sessions.length - 1], gate = deferred(); session.stopGate = gate.promise;
            session.emit('state', { state: 'playing' }); cancelled.recoverPlayer(cancelled.state.player, 'playback_stalled');
            cancelled.playerBack(); gate.resolve(); const count = sessions.length;
            return flush().then(() => assert.strictEqual(sessions.length, count, 'Back cancels pending recovery'));
        });
    }).then(() => {
        const navigation = create();
        navigation.state.screen = 'results'; navigation.state.results = { items: [{ id: 'a' }] }; navigation.state.resultsPage = 3;
        navigation.pushScreen(); navigation.state.resultsPage = 0; navigation.state.screen = 'details'; navigation.state.query = 'changed';
        navigation.back(); assert.strictEqual(navigation.state.screen, 'results'); assert.strictEqual(navigation.state.resultsPage, 3); assert.strictEqual(navigation.state.query, 'test');
        navigation.state.screen = 'home'; navigation.state.home = { rows: [] }; navigation.pushScreen();
        navigation.state.homeTop = 0; navigation.state.shelfOffsets.row = 0; navigation.state.screen = 'details'; navigation.back();
        assert.strictEqual(navigation.state.homeTop, 2); assert.strictEqual(navigation.state.shelfOffsets.row, 4);
        console.log('PASS Phoenix layout, hit targets, paused card, error actions, startup guards, recovery budget, teardown ordering, Back cancellation and restoration');
    });
};
