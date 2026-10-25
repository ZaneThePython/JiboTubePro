'use strict';
const assert = require('assert');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise: promise, resolve: resolve, reject: reject }; }
module.exports = function (Skill) {
    function create() {
        const skill = new Skill(); skill.opened = true; skill.active = () => true; skill.render = () => {};
        skill.state = { screen: 'home', tab: 'home', query: 'same', searchMode: 'all', library: {}, recentSearches: [] };
        skill.store = { payload: () => ({}), state: { history: [], likes: [], searches: [] }, search: () => {}, liked: () => false };
        skill.client = { thumb: () => '', close: () => {} };
        return skill;
    }
    const skill = create(), first = deferred(), second = deferred(); let calls = 0;
    skill.client.home = () => (++calls === 1 ? first.promise : second.promise);
    skill.loadHome(skill.generation); skill.nav('search'); skill.nav('home');
    first.resolve({ rows: [{ id: 'old', items: [] }] });
    return Promise.resolve().then(() => {
        assert.strictEqual(skill.state.screen, 'loading'); assert(!skill.state.home, 'older Home request cannot replace a newer request');
        second.resolve({ rows: [{ id: 'new', items: [] }] });
        return Promise.resolve();
    }).then(() => {
        assert.strictEqual(skill.state.home.rows[0].id, 'new');
        const trending = deferred(); skill.client.search = () => trending.promise;
        skill.nav('trending'); skill.nav('library'); trending.resolve({ items: [] });
        return Promise.resolve();
    }).then(() => {
        assert.strictEqual(skill.state.screen, 'library', 'late Trending success must not navigate');
        const home = deferred(); skill.state.home = null; skill.client.home = () => home.promise;
        skill.nav('home'); skill.nav('search'); home.reject(Error('late failure'));
        return Promise.resolve().then(() => Promise.resolve());
    }).then(() => {
        assert.strictEqual(skill.state.screen, 'search', 'late Home failure must not navigate');
        const music = deferred(); skill.client.musicHome = () => music.promise;
        skill.nav('music'); skill.nav('search'); music.resolve({ rows: [] });
        return Promise.resolve();
    }).then(() => {
        assert.strictEqual(skill.state.screen, 'search', 'late Music success must not navigate');
        const oldSearch = deferred(), musicSearch = deferred(); skill.client.search = () => oldSearch.promise; skill.client.musicSearch = () => musicSearch.promise;
        skill.search(); skill.setSearchMode('music'); oldSearch.resolve({ items: [{ id: 'wrong' }] });
        return Promise.resolve().then(() => { assert.strictEqual(skill.state.results.items.length, 0); musicSearch.resolve({ items: [{ id: 'right' }] }); });
    }).then(() => {
        assert.strictEqual(skill.state.results.items[0].id, 'right', 'same query with a new mode supersedes the old request');
        const details = deferred(); skill.client.video = () => details.promise;
        skill.startPlayer = () => { throw Error('stale details autoplay'); };
        skill.openVideoById('abcdefghijk', { id: 'abcdefghijk', duration: 60 }, true);
        skill.nav('library'); details.resolve({ video: { id: 'abcdefghijk', duration: 60 }, related: [], rows: [] });
        return Promise.resolve();
    }).then(() => assert.strictEqual(skill.state.screen, 'library', 'late autoplay details must not navigate'));
};
