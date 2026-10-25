'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./paths').dataRoot(), 'state.json');
const DIRECTORY = path.dirname(FILE);
function ensureDirectory(directory) {
    try { fs.mkdirSync(directory, 448); return; } catch (error) {
        if (error.code === 'EEXIST') return;
        if (error.code !== 'ENOENT') throw error;
        ensureDirectory(path.dirname(directory));
        try { fs.mkdirSync(directory, 448); } catch (again) { if (again.code !== 'EEXIST') throw again; }
    }
}
const MAX_HISTORY = 80;
const MAX_LIKES = 100;
const MAX_SEARCHES = 12;

function text(value, limit) {
    return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit || 200) : '';
}
function clampNumber(value, limit) {
    value = Number(value);
    return isFinite(value) && value >= 0 ? Math.min(value, limit || 86400) : 0;
}
function itemOf(value) {
    if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{11}$/.test(value.id || '')) return null;
    return {
        id: value.id,
        title: text(value.title, 220) || 'Untitled',
        channel: text(value.channel, 120),
        duration: clampNumber(value.duration, 86400),
        views: clampNumber(value.views, 1e12),
        thumb: '/thumb/' + value.id + '.jpg',
        music: value.music === true,
        position: clampNumber(value.position, 86400),
        at: clampNumber(value.at, 1e15) || Date.now()
    };
}

function Store() { this.lastError = null; this.state = this.read(); }

Store.prototype.defaults = function () {
    return { v: 1, history: [], likes: [], searches: [], settings: { autoplay: true, loop: false, captions: false } };
};
Store.prototype.read = function () {
    let parsed;
    try {
        const stat = fs.lstatSync(FILE);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 512 * 1024) return this.defaults();
        parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (_) { return this.defaults(); }
    if (!parsed || typeof parsed !== 'object') return this.defaults();
    const state = this.defaults();
    if (Array.isArray(parsed.history)) state.history = parsed.history.map(itemOf).filter(Boolean).slice(0, MAX_HISTORY);
    if (Array.isArray(parsed.likes)) {
        const seen = {};
        state.likes = parsed.likes.map(itemOf).filter(item => {
            if (!item || seen[item.id]) return false;
            seen[item.id] = true;
            return true;
        }).slice(0, MAX_LIKES);
    }
    if (Array.isArray(parsed.searches)) state.searches = parsed.searches.map(value => text(value, 80)).filter(Boolean).slice(0, MAX_SEARCHES);
    if (parsed.settings && typeof parsed.settings === 'object') {
        state.settings.autoplay = parsed.settings.autoplay !== false;
        state.settings.loop = parsed.settings.loop === true;
        state.settings.captions = parsed.settings.captions === true;
    }
    return state;
};
Store.prototype.save = function () {
    const temporary = FILE + '.tmp-' + process.pid;
    try {
        ensureDirectory(DIRECTORY);
        fs.writeFileSync(temporary, JSON.stringify(this.state) + '\n', { mode: 384 });
        fs.renameSync(temporary, FILE);
        this.lastError = null; return true;
    } catch (_) { try { fs.unlinkSync(temporary); } catch (ignored) {} this.lastError = 'storage_unavailable'; return false; }
};
Store.prototype.watched = function (item, position) {
    const value = itemOf(Object.assign({}, item, { position: position, at: Date.now() }));
    if (!value) return;
    this.state.history = this.state.history.filter(existing => existing.id !== value.id);
    this.state.history.unshift(value);
    if (this.state.history.length > MAX_HISTORY) this.state.history.length = MAX_HISTORY;
    this.save();
};
Store.prototype.liked = function (id) {
    return this.state.likes.some(item => item.id === id);
};
Store.prototype.like = function (item) {
    if (this.liked(item.id)) { this.unlike(item.id); return false; }
    const value = itemOf(item);
    if (!value) return false;
    value.at = Date.now();
    this.state.likes.unshift(value);
    if (this.state.likes.length > MAX_LIKES) this.state.likes.length = MAX_LIKES;
    this.save();
    return true;
};
Store.prototype.unlike = function (id) {
    this.state.likes = this.state.likes.filter(item => item.id !== id);
    this.save();
};
Store.prototype.search = function (query) {
    query = text(query, 80);
    if (!query) return;
    this.state.searches = [query].concat(this.state.searches.filter(value => value.toLowerCase() !== query.toLowerCase())).slice(0, MAX_SEARCHES);
    this.save();
};
Store.prototype.setAutoplay = function (value) {
    this.state.settings.autoplay = value !== false;
    this.save();
};
Store.prototype.setLoop = function (value) {
    this.state.settings.loop = value === true;
    this.save();
};
Store.prototype.setCaptions = function (value) {
    this.state.settings.captions = value === true;
    this.save();
};
Store.prototype.clearHistory = function () {
    this.state.history = [];
    this.save();
};
Store.prototype.payload = function () {
    return {
        history: this.state.history.slice(0, 20).map(item => ({ id: item.id, title: item.title, channel: item.channel,
            duration: item.duration, position: item.position, music: item.music === true, at: item.at })),
        likes: this.state.likes.map(item => item.id).slice(0, 20),
        searches: this.state.searches.slice(0, 8)
    };
};

module.exports = { Store: Store, FILE: FILE };
