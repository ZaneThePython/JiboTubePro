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
        const pass = resolve, fail = reject;
        resolve = function (value) { if (!owner || !owner.closed) pass(value); };
        reject = function (error) { if (!owner || !owner.closed) fail(error); };
        const target = url.parse(settings.base + pathname);
        const transport = target.protocol === 'https:' ? https : http;
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const headers = { 'Accept': 'application/json', 'X-JiboTube-Token': settings.token };
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
        const req = transport.request({
            protocol: target.protocol, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.path, method: method, headers: headers
        }, function (response) {
            const chunks = [];
            let size = 0;
            response.on('data', function (chunk) {
                size += chunk.length;
                if (size > MAX_BYTES) { req.abort(); reject(new Error('response_too_large')); return; }
                chunks.push(chunk);
            });
            response.on('end', function () {
                let value;
                try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                catch (_) { reject(new Error('bad_response')); return; }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    const error = new Error(value && value.error || ('http_' + response.statusCode));
                    error.code = value && value.error;
                    error.status = response.statusCode;
                    error.payload = value;
                    reject(error);
                    return;
                }
                resolve(value);
            });
        });
        if (owner) {
            owner.requests.push(req);
            req.on('close', function () { const index = owner.requests.indexOf(req); if (index >= 0) owner.requests.splice(index, 1); });
        }
        req.setTimeout(timeoutMs || TIMEOUT_MS, function () { req.abort(); reject(new Error('timeout')); });
        req.on('error', function (error) { reject(error); });
        if (payload) req.write(payload);
        req.end();
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

module.exports = { Client: Client, readConfig: readConfig, isLocal: isLocal, CONFIG: CONFIG };
