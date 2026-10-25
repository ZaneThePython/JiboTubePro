'use strict';

// JiboTube companion service client (Node 6.5: no async/await, no spread).
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');

const CONFIG = path.join(require('./paths').dataRoot(), 'client.json');
const TIMEOUT_MS = 40000;
const MAX_BYTES = 4 * 1024 * 1024;
const nodeTimers = require('timers');
const STATUS = {
    timeout: ['That took too long. Try again.', true],
    network_unavailable: ["Couldn't connect. Check your connection and try again.", true],
    provider_busy: ['The video service is busy. Wait a moment and try again.', true],
    provider_unavailable: ["The video service isn't available right now. Try again later.", true],
    provider_changed: ['The video service changed its response. Try another video.', false],
    age_restricted: ["This video needs an account and can't play here.", false],
    region: ["This video isn't available in your region.", false],
    members_only: ["This video is for members and can't play here.", false],
    unavailable: ["This video isn't available.", false],
    unsupported_live: ["Live and upcoming videos can't play here.", false],
    video_too_long: ['This video is too long to play here.', false],
    unsupported_format: ['This video has no format Jibo can play.', false],
    audio_missing: ['This video has no audio format Jibo can play.', false],
    host_unavailable: ["The video player couldn't start. Try again.", true],
    start_failed: ["The video player couldn't start. Try again.", true],
    window_timeout: ["The video display didn't open. Try again.", true],
    playback_stalled: ['Playback lost its connection. Try again.', true],
    playback_failed: ['Playback stopped. Try again or choose another video.', true],
    session_limit: ['JiboTube stopped after a long session. Close and reopen to keep watching.', false],
    storage_unavailable: ["Changes couldn't be saved. Playback can continue.", true],
    service_unavailable: ["JiboTube's local service couldn't start. Close and try again.", true],
    unauthorized: ["JiboTube couldn't connect to its local service. Close and reopen it.", true],
    teardown_unconfirmed: ["JiboTube couldn't finish closing. Close it and try again.", false]
};
function status(error) {
    let code = error && (error.code || error.message) || 'service_unavailable';
    const aliases = { stream_unavailable: 'unsupported_format', video_unavailable: 'unavailable', bad_response: 'provider_changed',
        bad_json: 'provider_changed', response_too_large: 'provider_changed', range_timeout: 'timeout', host_exit: 'playback_failed',
        play_error: 'playback_failed', player_exit: 'playback_failed', player: 'playback_failed' };
    if (/stop_unconfirmed|^jibotube_view_/.test(code)) code = 'teardown_unconfirmed';
    code = aliases[code] || code;
    if (!Object.prototype.hasOwnProperty.call(STATUS, code)) code = 'service_unavailable';
    return { code: code, title: code === 'storage_unavailable' ? 'Could not save changes' : 'JiboTube', body: STATUS[code][0],
        retryable: error && typeof error.retryable === 'boolean' ? error.retryable : STATUS[code][1], action: STATUS[code][1] ? 'Try again' : '' };
}
function failure(code) { const e = new Error(code); e.code = code; return e; }

function isLocal(base) {
    try {
        const parsed = url.parse(String(base || ''));
        return /^(127\.0\.0\.1|localhost|::1)$/.test(parsed.hostname || '');
    } catch (_) { return false; }
}

function readConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        if (!parsed || typeof parsed.base !== 'string' || !/^https?:\/\//.test(parsed.base)) return null;
        return { base: parsed.base.replace(/\/+$/, ''), token: typeof parsed.token === 'string' ? parsed.token : '' };
    } catch (_) { return null; }
}

function request(settings, method, pathname, body, timeoutMs, owner) {
    return new Promise(function (resolve, reject) {
        if (owner && owner.closed) return;
        if (owner && owner.requests.length >= 8) { reject(failure('provider_busy')); return; }
        let req = null, response = null, done = false, deadline = null;
        function finish(error, value) {
            if (done) return; done = true;
            nodeTimers.clearTimeout(deadline);
            if (owner && req) { const i = owner.requests.indexOf(req); if (i >= 0) owner.requests.splice(i, 1); }
            if (error) { if (req) req.abort(); if (response) response.destroy(); }
            if (owner && owner.closed) return;
            if (error) reject(error); else resolve(value);
        }
        try {
            const target = url.parse(settings.base + pathname);
            const transport = target.protocol === 'https:' ? https : http;
            const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
            const headers = { 'Accept': 'application/json', 'X-JiboTube-Token': settings.token };
            if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
            req = transport.request({ protocol: target.protocol, hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80), path: target.path, method: method, headers: headers
            }, function (res) {
                response = res;
                const chunks = []; let size = 0;
                res.on('data', function (chunk) {
                    if (done) return;
                    size += chunk.length;
                    if (size > MAX_BYTES) { finish(failure('provider_changed')); return; }
                    chunks.push(chunk);
                });
                res.on('aborted', function () { finish(failure('network_unavailable')); });
                res.on('error', function () { finish(failure('network_unavailable')); });
                res.on('end', function () {
                    if (done) return;
                    let value;
                    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                    catch (_) { finish(failure('provider_changed')); return; }
                    if (!value || typeof value !== 'object') { finish(failure('provider_changed')); return; }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        const error = failure(status({ code: value.error }).code); error.status = res.statusCode; error.retryable = typeof value.retryable === 'boolean' ? value.retryable : status(error).retryable;
                        finish(error); return;
                    }
                    finish(null, value);
                });
            });
            if (owner) owner.requests.push(req);
            deadline = nodeTimers.setTimeout(function () { finish(failure('timeout')); }, Math.max(1, Math.min(TIMEOUT_MS, timeoutMs || TIMEOUT_MS)));
            req.on('close', function () {
                if (!done && (!owner || !owner.closed)) { finish(failure('network_unavailable')); return; }
                nodeTimers.clearTimeout(deadline);
                if (owner) { const i = owner.requests.indexOf(req); if (i >= 0) owner.requests.splice(i, 1); }
            });
            req.on('error', function () { finish(failure('network_unavailable')); });
            if (payload) req.write(payload);
            req.end();
        } catch (_) { finish(failure('service_unavailable')); }
    });
}

function Client(settings) {
    this.settings = settings;
    this.cache = {}; this.requests = []; this.closed = false;
}
Client.prototype.close = function () {
    this.closed = true;
    this.requests.slice().forEach(function (req) { try { req.abort(); } catch (_) {} });
    this.requests = []; this.cache = {};
};
Client.prototype.request = function (method, pathname, body, timeoutMs) { return request(this.settings, method, pathname, body, timeoutMs, this); };
Client.prototype.remember = function (key, value) {
    this.cache[key] = { at: Date.now(), value: value };
    const keys = Object.keys(this.cache);
    while (keys.length > 32) delete this.cache[keys.shift()];
};
Client.prototype.configured = function () { return !!this.settings; };
Client.prototype.query = function (pathname, token) {
    return pathname + (pathname.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(this.settings.token);
};
Client.prototype.home = function (payload) {
    const key = 'home:' + JSON.stringify(payload || {});
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < 90000) return Promise.resolve(hit.value);
    return this.request( 'POST', this.query('/api/home'), payload || {}).then(function (value) {
        this.remember(key, value);
        return value;
    }.bind(this));
};
Client.prototype.musicHome = function (payload) {
    const key = 'music-home:' + JSON.stringify(payload || {});
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < 90000) return Promise.resolve(hit.value);
    return this.request( 'POST', this.query('/api/music/home'), payload || {}).then(function (value) {
        this.remember(key, value);
        return value;
    }.bind(this));
};
Client.prototype.musicSearch = function (query) {
    const key = 'music-search:' + String(query || '').toLowerCase();
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < 90000) return Promise.resolve(hit.value);
    return this.request( 'GET', this.query('/api/music/search?q=' + encodeURIComponent(query))).then(function (value) {
        this.remember(key, value);
        return value;
    }.bind(this));
};
Client.prototype.search = function (query) {
    const key = 'search:' + String(query || '').toLowerCase();
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < 90000) return Promise.resolve(hit.value);
    return this.request( 'GET', this.query('/api/search?q=' + encodeURIComponent(query))).then(function (value) {
        this.remember(key, value);
        return value;
    }.bind(this));
};
Client.prototype.video = function (id) {
    const key = 'video:' + id;
    const hit = this.cache[key];
    if (hit && Date.now() - hit.at < 180000) return Promise.resolve(hit.value);
    return this.request( 'GET', this.query('/api/video/' + id)).then(function (value) {
        this.remember(key, value);
        return value;
    }.bind(this));
};
Client.prototype.providerHealth = function () { return this.request('GET', this.query('/api/provider-health'), undefined, 20000); };
Client.prototype.captions = function (id) {
    return this.request( 'GET', this.query('/api/captions/' + id));
};
Client.prototype.stream = function (id, seconds, snapAfter) {
    return this.request( 'GET', this.query('/api/stream/' + id + '?t=' + Math.max(0, Number(seconds) || 0).toFixed(3) +
        (snapAfter ? '&snap=after' : '')), undefined, 20000);
};
Client.prototype.streamUrl = function (pathname) {
    if (!this.settings || !pathname) return '';
    return this.settings.base + pathname + (pathname.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(this.settings.token);
};
Client.prototype.shutdown = function () {
    if (!this.settings) return Promise.resolve(false);
    return this.request( 'GET', this.query('/shutdown')).then(function () { return true; }, function () { return false; });
};
Client.prototype.thumb = function (item, size) {
    if (!this.settings || !item || !item.thumb) return '';
    return this.settings.base + item.thumb + '?q=' + encodeURIComponent(size || 'mqdefault') + '&token=' + encodeURIComponent(this.settings.token);
};

module.exports = { Client: Client, readConfig: readConfig, isLocal: isLocal, CONFIG: CONFIG, status: status };
