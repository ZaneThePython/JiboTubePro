'use strict';

// Canvas player controls rendered above Pro's video texture in the same PIXI scene.
// PLAYER supplies both drawing rectangles and touch targets.
const W = 1280, H = 720;
const FONT = '"Proxima Nova Soft", sans-serif';
const PLAYER = {
    // Back sits exactly where the app's Back sits on every other screen.
    back: { x: 248, y: 16, w: 156, h: 72 },
    top: { x: 0, y: 0, w: W, h: 112 },
    // While paused: a big resume button in the middle of the picture.
    pausedCard: { x: 520, y: 136, w: 240, h: 208 },
    startCard: { x: 380, y: 268, w: 520, h: 128 },
    // Bottom block: times + scrubber, then one row of buttons.
    bar: { x: 0, y: 470, w: W, h: 250 },
    scrub: { x: 168, y: 520, w: 1040, h: 80 },
    seekSegments: 16,
    back10: { x: 168, y: 612, w: 96, h: 88 },
    play: { x: 276, y: 612, w: 112, h: 88 },
    fwd10: { x: 400, y: 612, w: 96, h: 88 },
    captions: { x: 528, y: 612, w: 112, h: 88 },
    volDown: { x: 672, y: 612, w: 88, h: 88 },
    volUp: { x: 848, y: 612, w: 88, h: 88 },
    settings: { x: 968, y: 612, w: 96, h: 88 },
    next: { x: 1076, y: 612, w: 132, h: 88 },
    panel: { x: 340, y: 132, w: 600, h: 452 },
    settingsRows: [
        { label: 'Captions', off: { x: 640, y: 212, w: 120, h: 64 }, on: { x: 776, y: 212, w: 120, h: 64 } },
        { label: 'Repeat', off: { x: 640, y: 296, w: 120, h: 64 }, on: { x: 776, y: 296, w: 120, h: 64 } },
        { label: 'Autoplay', off: { x: 640, y: 380, w: 120, h: 64 }, on: { x: 776, y: 380, w: 120, h: 64 } }
    ],
    done: { x: 530, y: 488, w: 220, h: 72 }
};

function canvas(width, height) {
    const element = document.createElement('canvas');
    element.width = width; element.height = height;
    return element;
}
function rounded(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function triangle(ctx, x, y, size, direction) {
    ctx.beginPath();
    if (direction === 'left') { ctx.moveTo(x + size, y); ctx.lineTo(x, y + size / 2); ctx.lineTo(x + size, y + size); }
    else { ctx.moveTo(x, y); ctx.lineTo(x + size, y + size / 2); ctx.lineTo(x, y + size); }
    ctx.closePath(); ctx.fill();
}
function disc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function clock(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2);
}
function text(ctx, value, x, y, size, color, align, weight) {
    ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y);
}
function ellipsis(ctx, value, width, size, weight) {
    ctx.font = (weight || 'normal') + ' ' + size + 'px ' + FONT;
    let result = String(value || '').replace(/[\uD800-\uDFFF\uFE0F\u200D\u2600-\u27BF]/g, '').replace(/\s+/g, ' ').trim();
    if (ctx.measureText(result).width <= width) return result;
    const chars = Array.from(result);
    while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > width) chars.pop();
    return chars.join('').replace(/\s+$/, '') + '…';
}
// A control's rectangle relative to a layer's origin.
function at(rect, origin) { return { x: rect.x - origin.x, y: rect.y - origin.y, w: rect.w, h: rect.h }; }
function button(ctx, r, fill, radius) { rounded(ctx, r.x, r.y, r.w, r.h, radius === undefined ? 16 : radius); ctx.fillStyle = fill; ctx.fill(); }
function speaker(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y + s * 0.34, s * 0.26, s * 0.32);
    ctx.beginPath(); ctx.moveTo(x + s * 0.22, y + s * 0.34); ctx.lineTo(x + s * 0.58, y + s * 0.08); ctx.lineTo(x + s * 0.58, y + s * 0.92); ctx.lineTo(x + s * 0.22, y + s * 0.66); ctx.closePath(); ctx.fill();
}
function skipGlyph(ctx, cx, cy, forward, color) {
    // A circular arrow with "10" inside: an abstract skip glyph.
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.beginPath();
    if (forward) ctx.arc(cx, cy, 34, -Math.PI * 0.35, Math.PI * 1.35, false); else ctx.arc(cx, cy, 34, Math.PI * 1.35, -Math.PI * 0.35, true);
    ctx.stroke();
    ctx.fillStyle = color;
    const tx = forward ? cx + 20 : cx - 20, dir = forward ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(tx - 2 * dir, cy - 46); ctx.lineTo(tx + 16 * dir, cy - 30); ctx.lineTo(tx - 6 * dir, cy - 22); ctx.closePath(); ctx.fill();
    text(ctx, '10', cx, cy + 2, 28, color, 'center', 'bold');
}

// Words while a video is getting ready (STATUS-CONTRACT active states).
// The controller reports `statusCode` (reconnecting) or a short statusText.
function startingWords(player) {
    const code = player && player.statusCode, text = player && player.statusText || '';
    if (code === 'reconnecting' || /^Reconnecting/.test(text)) return { title: 'Reconnecting…', body: 'Connection lost. Trying once more.' };
    if (code === 'format_fallback') return { title: 'Trying a lower quality…', body: 'This can take a few seconds.' };
    if (code === 'starting_service' || /local service/.test(text)) return { title: 'Starting JiboTube…', body: 'This can take a few seconds.' };
    if (/^Seeking/.test(text)) return { title: 'Jumping to ' + clock(player.position) + '…', body: 'One moment.' };
    if (/^Resuming/.test(text)) return { title: 'Resuming…', body: 'One moment.' };
    if (code === 'buffering' || /^Buffering/.test(text)) return { title: 'Getting the video ready…', body: 'This can take a few seconds.' };
    return { title: 'Starting video…', body: 'This can take a few seconds.' };
}

class Overlay {
    // stage: JiboTube's PIXI container; repaint: draws BE now (the face
    // renderer only ticks a few times a second during playback).
    constructor(stage, repaint) {
        this.top = canvas(W, PLAYER.top.h);
        this.bar = canvas(W, PLAYER.bar.h);
        this.time = canvas(1080, 140);
        this.center = canvas(PLAYER.startCard.w, PLAYER.pausedCard.h);
        this.toast = canvas(860, 64);
        this.caption = canvas(1000, 100);
        this.settings = canvas(PLAYER.panel.w, PLAYER.panel.h);
        this.keys = {};
        this.lastTime = 0;
        this.active = false;
        this.stage = stage || null;
        this.repaint = repaint || null;
        this.PIXI = global.PIXI || null;
        this.container = this.PIXI ? new this.PIXI.Container() : null;
        if (this.stage && this.container) this.stage.addChild(this.container);
        this.sprites = {};
        this.holes = {};
        this.holesKey = '';
        this.changed = false;
    }
    // hole: the screen rectangle the part covers (default: the whole canvas).
    layer(session, name, element, width, height, x, y, hole) {
        if (!this.container) return;
        let entry = this.sprites[name];
        try {
            if (!entry) {
                const texture = this.PIXI.Texture.fromCanvas(element);
                const sprite = new this.PIXI.Sprite(texture);
                this.container.addChild(sprite);
                entry = this.sprites[name] = { sprite: sprite, texture: texture };
            } else {
                entry.texture.baseTexture.update();
            }
            entry.sprite.position.set(x, y);
            entry.sprite.visible = true;
        } catch (_) { return; }
        if (hole !== false) this.holes[name] = hole || { x: x, y: y, width: width, height: height };
        this.changed = true;
    }
    destroy() {
        const container = this.container;
        this.container = null;
        Object.keys(this.sprites).forEach(name => {
            try { this.sprites[name].texture.destroy(true); } catch (_) {}
        });
        this.sprites = {};
        if (container) {
            try { if (container.parent) container.parent.removeChild(container); container.destroy({ children: true }); } catch (_) {}
        }
    }
    // Back and the title: shown whenever controls are, and while starting.
    drawTop(session, player) {
        const ctx = this.top.getContext('2d'), h = PLAYER.top.h, b = PLAYER.back;
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, W, h);
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, h);
        button(ctx, b, '#17363F');
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.moveTo(b.x + 40, b.y + 20); ctx.lineTo(b.x + 24, b.y + 36); ctx.lineTo(b.x + 40, b.y + 52); ctx.lineTo(b.x + 46, b.y + 46);
        ctx.lineTo(b.x + 36, b.y + 36); ctx.lineTo(b.x + 46, b.y + 26); ctx.closePath(); ctx.fill();
        text(ctx, 'Back', b.x + 98, b.y + b.h / 2, 24, '#FFFFFF', 'center', 'bold');
        const x = b.x + b.w + 24, width = 1200 - x;
        text(ctx, ellipsis(ctx, player.title, width, 28, 'bold'), x, 38, 28, '#FFFFFF', 'left', 'bold');
        // SponsorBlock is on for this video: a short pill beside the channel.
        let channelWidth = width;
        if (player.sponsorCount > 0) {
            const label = 'SponsorBlock on';
            ctx.font = 'bold 20px ' + FONT;
            const pill = Math.ceil(ctx.measureText(label).width) + 32;
            rounded(ctx, 1200 - pill, 58, pill, 34, 17); ctx.fillStyle = 'rgba(12,42,48,0.95)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,194,102,0.9)'; ctx.lineWidth = 2; ctx.stroke();
            text(ctx, label, 1200 - pill / 2, 76, 20, '#FFD28C', 'center', 'bold');
            channelWidth = width - pill - 20;
        }
        text(ctx, ellipsis(ctx, player.channel, channelWidth, 22), x, 74, 22, 'rgba(206,228,234,0.95)', 'left');
        this.layer(session, 'jt-top', this.top, W, h, 0, 0);
    }
    // The middle of the picture stays clear while playing. It shows a card
    // only while a video is starting, or a big Play button while paused.
    drawCenter(session, player) {
        const ctx = this.center.getContext('2d');
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, this.center.width, this.center.height);
        if (player.starting) {
            const o = PLAYER.startCard, words = startingWords(player);
            ctx.fillStyle = '#091B21'; ctx.fillRect(0, 0, o.w, o.h);
            text(ctx, ellipsis(ctx, words.title, o.w - 48, 28, 'bold'), o.w / 2, 44, 28, '#FFFFFF', 'center', 'bold');
            text(ctx, ellipsis(ctx, words.body, o.w - 48, 22), o.w / 2, 84, 22, 'rgba(196,220,226,0.95)', 'center');
            const phase = (Date.now() % 1600) / 1600;
            rounded(ctx, 60, 106, o.w - 120, 8, 4); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
            rounded(ctx, 60 + phase * (o.w - 120) * 0.75, 106, (o.w - 120) / 4, 8, 4); ctx.fillStyle = '#2FD0C0'; ctx.fill();
            this.layer(session, 'jt-center', this.center, o.w, o.h, o.x, o.y, { x: o.x, y: o.y, width: o.w, height: o.h });
            return;
        }
        const o = PLAYER.pausedCard;
        ctx.fillStyle = '#091B21'; ctx.fillRect(0, 0, o.w, o.h);
        ctx.fillStyle = '#FFFFFF'; disc(ctx, o.w / 2, 86, 62);
        ctx.fillStyle = '#08181E'; triangle(ctx, o.w / 2 - 18, 86 - 30, 60, 'right');
        text(ctx, 'Paused', o.w / 2, 178, 26, '#FFFFFF', 'center', 'bold');
        this.layer(session, 'jt-center', this.center, o.w, o.h, o.x, o.y, { x: o.x, y: o.y, width: o.w, height: o.h });
    }
    // Bottom row: -10 s, Play/Pause, +10 s, Captions, volume, settings, Next.
    drawBar(session, player) {
        const o = PLAYER.bar, ctx = this.bar.getContext('2d');
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, W, o.h);
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, o.h);
        const panel = '#17363F', white = '#FFFFFF';
        const b10 = at(PLAYER.back10, o), f10 = at(PLAYER.fwd10, o), p = at(PLAYER.play, o);
        button(ctx, b10, panel); button(ctx, f10, panel);
        skipGlyph(ctx, b10.x + b10.w / 2, b10.y + b10.h / 2 + 4, false, white);
        skipGlyph(ctx, f10.x + f10.w / 2, f10.y + f10.h / 2 + 4, true, white);
        button(ctx, p, '#2FD0C0');
        ctx.fillStyle = '#03211E';
        if (player.paused) triangle(ctx, p.x + p.w / 2 - 14, p.y + p.h / 2 - 22, 44, 'right');
        else { ctx.fillRect(p.x + p.w / 2 - 18, p.y + p.h / 2 - 22, 12, 44); ctx.fillRect(p.x + p.w / 2 + 6, p.y + p.h / 2 - 22, 12, 44); }
        const cc = at(PLAYER.captions, o), unavailable = player.captionsAvailable === false;
        button(ctx, cc, player.captionsOn ? '#2FD0C0' : panel);
        const ccInk = player.captionsOn ? '#03211E' : unavailable ? 'rgba(255,255,255,0.4)' : white;
        rounded(ctx, cc.x + 24, cc.y + 22, 64, 44, 8); ctx.strokeStyle = ccInk; ctx.lineWidth = 4; ctx.stroke();
        text(ctx, 'CC', cc.x + 56, cc.y + 45, 24, ccInk, 'center', 'bold');
        const down = at(PLAYER.volDown, o), up = at(PLAYER.volUp, o);
        button(ctx, down, panel); button(ctx, up, panel);
        ctx.fillStyle = white; ctx.fillRect(down.x + 26, down.y + 41, 36, 7);
        ctx.fillRect(up.x + 26, up.y + 41, 36, 7); ctx.fillRect(up.x + 40.5, up.y + 26, 7, 36);
        const level = Math.max(0, Math.min(10, Math.round(player.volume == null ? 7 : player.volume)));
        speaker(ctx, down.x + down.w + 8, down.y + 26, 36, 'rgba(255,255,255,0.92)');
        text(ctx, String(level), down.x + down.w + 64, down.y + 45, 30, white, 'center', 'bold');
        const gear = at(PLAYER.settings, o);
        button(ctx, gear, panel);
        ctx.save(); ctx.translate(gear.x + gear.w / 2, gear.y + gear.h / 2);
        ctx.fillStyle = white;
        for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * Math.PI / 4); ctx.fillRect(-5, -26, 10, 12); ctx.restore(); }
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.lineWidth = 7; ctx.strokeStyle = white; ctx.stroke();
        ctx.restore();
        if (player.nextTitle) {
            const next = at(PLAYER.next, o);
            button(ctx, next, panel);
            ctx.fillStyle = white; triangle(ctx, next.x + 18, next.y + 28, 32, 'right'); ctx.fillRect(next.x + 52, next.y + 28, 7, 32);
            text(ctx, 'Next', next.x + 96, next.y + 45, 24, white, 'center', 'bold');
        }
        this.layer(session, 'jt-bar', this.bar, W, o.h, 0, o.y);
    }
    // Times and the scrubber: redrawn about once a second.
    drawTime(session, player) {
        const ctx = this.time.getContext('2d'), s = PLAYER.scrub, ox = s.x - 20, oy = PLAYER.bar.y;
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, 1080, 140);
        const fraction = Math.max(0, Math.min(1, (player.position || 0) / Math.max(1, player.duration || 1)));
        const x = s.x - ox, y = s.y - oy + s.h / 2, w = s.w;
        rounded(ctx, x, y - 6, w, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
        rounded(ctx, x, y - 6, Math.max(12, w * fraction), 12, 6); ctx.fillStyle = '#FF6B5A'; ctx.fill();
        ctx.fillStyle = '#FFFFFF'; disc(ctx, x + w * fraction, y, 16);
        text(ctx, clock(player.position), x, 26, 26, '#FFFFFF', 'left', 'bold');
        text(ctx, clock(player.duration), x + w, 26, 26, '#FFFFFF', 'right', 'bold');
        this.layer(session, 'jt-time', this.time, 1080, 140, ox, oy, false); // inside the bar's hole
    }
    drawCaption(session, player) {
        if (!player.captionText) { this.remove(session, 'jt-caption'); return; }
        const ctx = this.caption.getContext('2d');
        ctx.globalAlpha = 1; ctx.clearRect(0, 0, 1000, 100);
        const words = String(player.captionText).split(' '), lines = []; let line = '';
        ctx.font = 'bold 28px ' + FONT;
        words.forEach(word => {
            const test = (line + ' ' + word).trim();
            if (ctx.measureText(test).width > 940 && line) { lines.push(line); line = word; }
            else line = test;
        });
        if (line) lines.push(line);
        const shown = lines.slice(-2);
        const height = 20 + shown.length * 36;
        ctx.fillStyle = '#020A0D'; ctx.fillRect(0, 100 - height, 1000, height);
        shown.forEach((entry, index) => text(ctx, ellipsis(ctx, entry, 960, 28, 'bold'), 500, 100 - height + 28 + index * 36, 28, '#FFFFFF', 'center', 'bold'));
        // Above the controls when they are shown, near the bottom otherwise.
        const bottom = player.controlsVisible !== false || player.paused ? 462 : 700;
        this.layer(session, 'jt-caption', this.caption, 1000, 100, 140, bottom - 100, { x: 140, y: bottom - height, width: 1000, height: height });
    }
    drawSettings(session, player) {
        if (!player.settingsOpen) { this.remove(session, 'jt-settings'); return; }
        const o = PLAYER.panel, ctx = this.settings.getContext('2d');
        ctx.globalAlpha = 1; ctx.clearRect(0, 0, o.w, o.h);
        ctx.fillStyle = '#091B21'; ctx.fillRect(0, 0, o.w, o.h);
        ctx.fillStyle = '#2FD0C0'; ctx.fillRect(0, 0, o.w, 6);
        text(ctx, 'Player settings', o.w / 2, 44, 30, '#FFFFFF', 'center', 'bold');
        const chip = (r, label, selected, disabled) => {
            const c = at(r, o);
            rounded(ctx, c.x, c.y, c.w, c.h, 16); ctx.fillStyle = selected ? '#2FD0C0' : 'rgba(255,255,255,0.10)'; ctx.fill();
            text(ctx, label, c.x + c.w / 2, c.y + c.h / 2 + 1, 24, disabled ? 'rgba(255,255,255,0.4)' : selected ? '#03211E' : '#FFFFFF', 'center', 'bold');
        };
        const values = [player.captionsOn, player.loop, player.autoplay];
        PLAYER.settingsRows.forEach((row, i) => {
            const y = row.off.y - o.y + row.off.h / 2;
            text(ctx, row.label, 44, y, 26, '#FFFFFF', 'left', 'bold');
            if (i === 0 && player.captionsAvailable === false) text(ctx, 'None for this video', 44, y + 26, 18, 'rgba(196,220,226,0.85)', 'left');
            chip(row.off, 'Off', !values[i]);
            chip(row.on, 'On', !!values[i], i === 0 && player.captionsAvailable === false);
        });
        const d = at(PLAYER.done, o);
        rounded(ctx, d.x, d.y, d.w, d.h, 16); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
        text(ctx, 'Done', d.x + d.w / 2, d.y + d.h / 2, 26, '#FFFFFF', 'center', 'bold');
        this.layer(session, 'jt-settings', this.settings, o.w, o.h, o.x, o.y);
    }
    drawToast(session, player) {
        if (!player.toast) { this.remove(session, 'jt-toast'); return; }
        const ctx = this.toast.getContext('2d');
        ctx.clearRect(0, 0, 860, 64);
        ctx.fillStyle = '#0B2A31'; ctx.fillRect(0, 4, 860, 56);
        ctx.fillStyle = '#2FD0C0'; ctx.fillRect(0, 4, 6, 56);
        text(ctx, ellipsis(ctx, player.toast, 800, 22, 'bold'), 30, 33, 22, 'rgba(236,250,252,0.98)', 'left', 'bold');
        this.layer(session, 'jt-toast', this.toast, 860, 64, 210, 124, { x: 210, y: 128, width: 860, height: 56 });
    }
    remove(session, name) {
        const entry = this.sprites[name];
        if (entry && entry.sprite.visible) { entry.sprite.visible = false; this.changed = true; }
        if (this.holes[name]) { delete this.holes[name]; this.changed = true; }
    }
    // Send the holes when they changed, keep the sprites above JiboTube's
    // screens (the UI re-adds its displays) and draw BE now.
    flush(session) {
        if (!this.changed) return;
        this.changed = false;
        const rects = Object.keys(this.holes).map(name => this.holes[name]);
        const key = JSON.stringify(rects);
        if (key !== this.holesKey) {
            this.holesKey = key;
            try { session.setHoles(rects); } catch (_) {}
        }
        if (this.stage && this.container) this.stage.addChild(this.container);
        if (this.repaint) this.repaint();
    }
    // Draw everything again on the next update (the host lost its layers).
    resend() { this.keys = {}; this.lastTime = 0; }
    // Only layers whose content changed are redrawn: a blanket redraw cost up
    // to a third of a second of the renderer per tap. A new video session
    // starts with no layers and gets everything once. `force` only marks a
    // moment that must be current, such as the clock after a seek.
    update(session, player, force) {
        if (!session || !player) return;
        if (this.session !== session) { this.session = session; this.resend(); this.holesKey = ''; }
        const settings = !!player.settingsOpen && !player.ended;
        const controls = !player.ended && (player.controlsVisible !== false || player.paused);
        const top = controls || settings || player.starting;
        const bar = controls && !settings && !player.starting;
        if (!top) { this.remove(session, 'jt-top'); delete this.keys.top; }
        else {
            const topKey = [player.id, player.title, player.channel, player.sponsorCount].join('|');
            if (this.keys.top !== topKey) { this.keys.top = topKey; this.drawTop(session, player); }
        }
        if (!bar) {
            this.remove(session, 'jt-bar'); this.remove(session, 'jt-time');
            delete this.keys.bar; delete this.keys.time; this.lastTime = 0;
        } else {
            const barKey = [player.id, player.paused, player.captionsOn, player.captionsAvailable, Math.round(player.volume == null ? 7 : player.volume), player.nextTitle].join('|');
            if (this.keys.bar !== barKey) { this.keys.bar = barKey; this.drawBar(session, player); }
            const timeKey = [player.id, Math.floor(player.position || 0), player.duration].join('|');
            if (this.keys.time !== timeKey && (force || Date.now() - this.lastTime > 1000)) {
                this.keys.time = timeKey; this.lastTime = Date.now(); this.drawTime(session, player);
            }
        }
        const centerShown = player.starting || (player.paused && !settings && !player.ended);
        if (!centerShown) { this.remove(session, 'jt-center'); delete this.keys.center; }
        else {
            const centerKey = [player.id, player.starting, player.paused, player.starting ? player.statusText + '|' + (player.statusCode || '') + '|' + Math.floor(player.position || 0) + '|' + Math.floor(Date.now() / 400) : ''].join('|');
            if (this.keys.center !== centerKey) { this.keys.center = centerKey; this.drawCenter(session, player); }
        }
        const toast = settings ? '' : player.toast;
        const toastKey = [player.id, toast].join('|');
        if (this.keys.toast !== toastKey) { this.keys.toast = toastKey; this.drawToast(session, Object.assign({}, player, { toast: toast })); }
        const captionKey = [player.id, player.captionsOn, player.captionText, controls].join('|');
        if (this.keys.caption !== captionKey) { this.keys.caption = captionKey; this.drawCaption(session, player); }
        const settingsKey = [player.id, settings, player.captionsOn, player.loop, player.autoplay, player.captionsAvailable].join('|');
        if (this.keys.settings !== settingsKey) { this.keys.settings = settingsKey; this.drawSettings(session, Object.assign({}, player, { settingsOpen: settings })); }
        this.flush(session);
    }
    reset() { this.keys = {}; this.lastTime = 0; }
}

module.exports = { Overlay: Overlay, PLAYER: PLAYER, startingWords: startingWords };
