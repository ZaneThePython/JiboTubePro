'use strict';

// Bounded thumbnail textures for the archived PIXI 4 renderer. Only this
// service's thumbnail URLs are fetched, through a CORS-clean <img> so WebGL
// never receives a tainted image. Loads are limited in parallelism (3), cache
// size (12 textures) and pixel size (1400 px). Nothing is persisted.
const ART_URL = /^https?:\/\/[^\s"'<>]+\/thumb\/[A-Za-z0-9_-]{11}\.jpg(?:\?[^\s"'<>]*)?$/;
function valid(url) { return typeof url === 'string' && url.length <= 480 && ART_URL.test(url); }

class ArtCache {
    constructor(PIXI, options) {
        options = options || {};
        this.PIXI = PIXI;
        this.createImage = options.createImage || (() => new global.Image());
        this.timers = options.timers;
        this.changed = options.changed || (() => {});
        this.limit = options.limit || 14;
        this.parallel = options.parallel || 3;
        this.timeoutMs = options.timeoutMs || 12000;
        this.retryMs = options.retryMs || 60000;
        this.maxPixels = options.maxPixels || 1400;
        this.now = options.now || Date.now;
        this.entries = new Map(); this.waiting = []; this.loading = 0; this.closed = false; this.tick = 0; this.wanted = [];
    }
    // Returns a ready texture or null. A null result schedules a bounded load
    // when this URL is part of the current screen (see want()).
    texture(url) {
        if (this.closed || !valid(url)) return null;
        const entry = this.entries.get(url);
        if (entry && entry.state === 'ready') { entry.used = ++this.tick; return entry.texture; }
        return null;
    }
    // The visible screen's URLs, in priority order. Older queued requests are
    // dropped so quick paging never builds an unbounded backlog.
    want(urls) {
        if (this.closed) return;
        const list = [];
        (urls || []).forEach(url => { if (valid(url) && list.indexOf(url) < 0 && list.length < this.limit) list.push(url); });
        this.wanted = list;
        this.waiting = [];
        list.forEach(url => {
            const entry = this.entries.get(url);
            if (entry && entry.state === 'ready') entry.used = ++this.tick;
            else if (!entry || (entry.state === 'failed' && this.now() - entry.failedAt >= this.retryMs)) this.waiting.push(url);
        });
        this.pump();
    }
    pump() {
        while (!this.closed && this.loading < this.parallel && this.waiting.length) {
            const url = this.waiting.shift(), entry = this.entries.get(url);
            if (entry && entry.state !== 'failed') continue;
            this.evict(1);
            this.start(url);
        }
    }
    start(url) {
        const entry = { url, state: 'loading', texture: null, image: null, timer: null, used: ++this.tick, failedAt: 0 };
        this.entries.set(url, entry); this.loading++;
        let image;
        const finish = ok => {
            if (entry.state !== 'loading') return;
            this.loading--;
            if (entry.timer !== null && this.timers) this.timers.clearTimeout(entry.timer);
            entry.timer = null;
            if (image) { image.onload = null; image.onerror = null; }
            if (!this.closed && ok && image && image.naturalWidth > 0 && image.naturalHeight > 0 &&
                image.naturalWidth <= this.maxPixels && image.naturalHeight <= this.maxPixels) {
                try {
                    entry.texture = new this.PIXI.Texture(new this.PIXI.BaseTexture(image));
                    entry.state = 'ready'; entry.image = null;
                } catch (_) { entry.texture = null; }
            }
            if (entry.state !== 'ready') {
                entry.state = 'failed'; entry.failedAt = this.now(); entry.image = null;
                if (image) { try { image.src = ''; } catch (_) {} }
            }
            if (this.closed) return;
            this.pump();
            if (entry.state === 'ready') { try { this.changed(); } catch (_) {} }
        };
        try {
            image = entry.image = this.createImage();
            image.crossOrigin = 'anonymous';
            image.onload = () => finish(true);
            image.onerror = () => finish(false);
            if (this.timers) entry.timer = this.timers.setTimeout(() => { entry.timer = null; finish(false); }, this.timeoutMs);
            image.src = url;
        } catch (_) { finish(false); }
    }
    // Keep at most `limit` entries. Only ready or failed entries that are not
    // on screen are removed; callers never show a texture outside want().
    evict(room) {
        const max = Math.max(0, this.limit - (room || 0));
        if (this.entries.size <= max) return;
        const candidates = [];
        this.entries.forEach(entry => { if (entry.state !== 'loading' && this.wanted.indexOf(entry.url) < 0) candidates.push(entry); });
        candidates.sort((a, b) => a.used - b.used);
        while (this.entries.size > max && candidates.length) this.drop(candidates.shift());
    }
    drop(entry) {
        this.entries.delete(entry.url);
        if (entry.texture) { try { entry.texture.destroy(true); } catch (_) {} }
        entry.texture = null;
    }
    // Cancels every pending request and frees every texture. The caller must
    // first detach sprites that display these textures.
    destroy() {
        if (this.closed) return;
        this.closed = true; this.waiting = []; this.wanted = [];
        this.entries.forEach(entry => {
            if (entry.state === 'loading') {
                entry.state = 'cancelled';
                if (entry.timer !== null && this.timers) this.timers.clearTimeout(entry.timer);
                entry.timer = null;
                const image = entry.image;
                if (image) { image.onload = null; image.onerror = null; try { image.src = ''; } catch (_) {} }
                entry.image = null;
            }
            this.drop(entry);
        });
        this.entries.clear(); this.loading = 0;
    }
    stats() {
        let ready = 0, loading = 0, failed = 0;
        this.entries.forEach(entry => { if (entry.state === 'ready') ready++; else if (entry.state === 'loading') loading++; else failed++; });
        return { ready, loading, failed, waiting: this.waiting.length, entries: this.entries.size };
    }
}
module.exports = { ArtCache, valid };
