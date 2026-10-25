'use strict';

// Canvas-drawn player controls rendered as PIXI sprites above the video texture.
const W = 1280, H = 720;
const FONT = '"Proxima Nova Soft", sans-serif';

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
    let result = String(value || '');
    if (ctx.measureText(result).width <= width) return result;
    while (result.length > 1 && ctx.measureText(result + '…').width > width) result = result.slice(0, -1);
    return result.replace(/\s+$/, '') + '…';
}

class Overlay {
    // stage: JiboTube's PIXI container; repaint: draws BE now (the face
    // renderer only ticks a few times a second during playback).
    constructor(stage, repaint) {
        this.top = canvas(W, 104);
        this.bar = canvas(W, 180);
        this.time = canvas(900, 76);
        this.center = canvas(720, 420);
        this.toast = canvas(860, 64);
        this.vol = canvas(250, 64);
        this.caption = canvas(1000, 90);
        this.settings = canvas(680, 420);
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
    drawTop(session, player) {
        const ctx = this.top.getContext('2d');
        ctx.globalAlpha = player.controlsAlpha == null ? 1 : player.controlsAlpha;
        ctx.clearRect(0, 0, W, 104);
        const gradient = ctx.createLinearGradient(0, 0, 0, 104);
        gradient.addColorStop(0, 'rgba(0,0,0,0.82)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, 104);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.moveTo(46, 34); ctx.lineTo(30, 50); ctx.lineTo(46, 66); ctx.lineTo(46, 58);
        ctx.lineTo(62, 58); ctx.lineTo(62, 42); ctx.lineTo(46, 42); ctx.closePath(); ctx.fill();
        text(ctx, ellipsis(ctx, player.title, 820, 30, 'bold'), 84, 38, 30, 'rgba(255,255,255,0.97)', 'left', 'bold');
        text(ctx, ellipsis(ctx, player.channel, 820, 20), 84, 72, 20, 'rgba(200,225,232,0.86)', 'left');
        if (player.sponsorCount > 0) {
            rounded(ctx, 1004, 26, 232, 40, 20); ctx.fillStyle = 'rgba(12,42,48,0.9)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,184,77,0.85)'; ctx.lineWidth = 2; ctx.stroke();
            text(ctx, ellipsis(ctx, 'SponsorBlock · ' + player.sponsorCount + ' skipped', 208, 19, 'bold'), 1120, 47, 19, 'rgba(255,211,140,0.98)', 'center', 'bold');
        }
        this.layer(session, 'jt-top', this.top, W, 104, 0, 0);
    }
    drawBar(session, player) {
        const ctx = this.bar.getContext('2d');
        ctx.globalAlpha = player.controlsAlpha == null ? 1 : player.controlsAlpha;
        ctx.clearRect(0, 0, W, 180);
        const gradient = ctx.createLinearGradient(0, 0, 0, 180);
        gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(0.45, 'rgba(0,0,0,0.55)'); gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, 180);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        // -10
        triangle(ctx, 60, 92, 18, 'left'); triangle(ctx, 78, 92, 18, 'left');
        text(ctx, '10', 82, 136, 17, 'rgba(255,255,255,0.9)', 'center', 'bold');
        // Play / pause disc.
        ctx.beginPath(); ctx.arc(178, 114, 34, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill();
        ctx.fillStyle = 'rgba(8,24,30,0.95)';
        if (player.paused || player.ended) triangle(ctx, 168, 100, 28, 'right');
        else { ctx.fillRect(166, 98, 9, 32); ctx.fillRect(183, 98, 9, 32); }
        // +10
        triangle(ctx, 264, 92, 18, 'right'); triangle(ctx, 282, 92, 18, 'right');
        text(ctx, '10', 278, 136, 17, 'rgba(255,255,255,0.9)', 'center', 'bold');
        // Next
        triangle(ctx, 1168, 94, 22, 'right'); ctx.fillRect(1194, 94, 6, 40);
        text(ctx, 'Next', 1182, 148, 16, 'rgba(200,225,232,0.8)', 'center');
        // Up next title
        if (player.nextTitle) text(ctx, 'Up next · ' + ellipsis(ctx, player.nextTitle, 560, 18), 332, 24, 18, 'rgba(200,225,232,0.78)', 'left');
        // Settings gear (invisible BE button at 900,552).
        ctx.save(); ctx.translate(936, 44);
        ctx.strokeStyle = 'rgba(255,255,255,0.86)'; ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.lineWidth = 3;
        for (var gi = 0; gi < 8; gi++) {
            ctx.save(); ctx.rotate(gi * Math.PI / 4); ctx.fillRect(-4, -23, 8, 9); ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        this.layer(session, 'jt-bar', this.bar, W, 180, 0, 540, { x: 0, y: 556, width: W, height: 164 });
    }
    drawTime(session, player) {
        const ctx = this.time.getContext('2d');
        ctx.globalAlpha = player.controlsAlpha == null ? 1 : player.controlsAlpha;
        const width = 806, x = 32, y = 34;
        ctx.clearRect(0, 0, 900, 76);
        const fraction = Math.max(0, Math.min(1, (player.position || 0) / Math.max(1, player.duration || 1)));
        rounded(ctx, x, y, width, 6, 3); ctx.fillStyle = 'rgba(255,255,255,0.26)'; ctx.fill();
        rounded(ctx, x, y, Math.max(6, width * fraction), 6, 3); ctx.fillStyle = '#FF6B5A'; ctx.fill();
        ctx.beginPath(); ctx.arc(x + width * fraction, y + 3, 8, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
        text(ctx, clock(player.position), x, 62, 18, 'rgba(235,248,250,0.9)', 'left', 'bold');
        text(ctx, clock(player.duration), x + width, 62, 18, 'rgba(235,248,250,0.9)', 'right', 'bold');
        this.layer(session, 'jt-time', this.time, 900, 76, 300, 604, false); // inside the bar's hole
    }
    drawCenter(session, player) {
        const ctx = this.center.getContext('2d');
        ctx.clearRect(0, 0, 720, 420);
        if (player.starting) {
            ctx.fillStyle = 'rgba(4,16,20,0.55)'; rounded(ctx, 90, 120, 540, 150, 24); ctx.fill();
            text(ctx, player.statusText || 'Starting…', 360, 186, 28, 'rgba(255,255,255,0.95)', 'center', 'bold');
            text(ctx, 'Preparing your video on Jibo', 360, 224, 18, 'rgba(180,212,220,0.85)', 'center');
            this.layer(session, 'jt-center', this.center, 720, 420, 280, 150, { x: 370, y: 270, width: 540, height: 150 });
            return;
        }
        if (player.ended) {
            ctx.fillStyle = 'rgba(4,16,20,0.82)'; rounded(ctx, 60, 70, 600, 280, 28); ctx.fill();
            ctx.strokeStyle = 'rgba(47,208,192,0.55)'; ctx.lineWidth = 2; ctx.stroke();
            text(ctx, 'Up next', 360, 118, 20, 'rgba(47,208,192,0.95)', 'center', 'bold');
            text(ctx, ellipsis(ctx, player.nextTitle || 'Pick another video', 520, 28, 'bold'), 360, 164, 28, '#FFFFFF', 'center', 'bold');
            text(ctx, player.autoplayIn > 0 ? 'Playing in ' + player.autoplayIn + 's' : 'Autoplay is off', 360, 204, 18, 'rgba(180,212,220,0.85)', 'center');
            rounded(ctx, 280, 220, 180, 56, 14); ctx.fillStyle = 'rgba(47,208,192,0.95)'; ctx.fill();
            text(ctx, 'Replay', 370, 249, 20, '#03211E', 'center', 'bold');
            rounded(ctx, 540, 220, 170, 56, 14); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
            text(ctx, 'Cancel', 625, 249, 20, '#FFFFFF', 'center', 'bold');
            this.layer(session, 'jt-center', this.center, 720, 420, 280, 150, { x: 340, y: 220, width: 600, height: 280 });
            return;
        }
        if (player.paused) {
            ctx.beginPath(); ctx.arc(360, 210, 52, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
            ctx.fillStyle = 'rgba(8,24,30,0.95)'; triangle(ctx, 344, 182, 42, 'right');
            rounded(ctx, 280, 278, 160, 44, 22); ctx.fillStyle = 'rgba(4,16,20,0.72)'; ctx.fill();
            text(ctx, 'Paused', 360, 300, 24, 'rgba(255,255,255,0.95)', 'center', 'bold');
            this.layer(session, 'jt-center', this.center, 720, 420, 280, 150, { x: 558, y: 306, width: 164, height: 168 });
            return;
        }
        this.remove(session, 'jt-center');
    }
    drawVolume(session, player) {
        const ctx = this.vol.getContext('2d');
        ctx.globalAlpha = player.controlsAlpha == null ? 1 : player.controlsAlpha;
        ctx.clearRect(0, 0, 250, 64);
        rounded(ctx, 0, 0, 250, 64, 32); ctx.fillStyle = 'rgba(6,22,28,0.66)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        text(ctx, '−', 40, 33, 28, 'rgba(255,255,255,0.94)', 'center', 'bold');
        text(ctx, '+', 212, 33, 26, 'rgba(255,255,255,0.94)', 'center', 'bold');
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.beginPath(); ctx.moveTo(78, 33); ctx.lineTo(90, 23); ctx.lineTo(90, 55); ctx.lineTo(78, 45); ctx.closePath(); ctx.fill();
        ctx.fillRect(74, 31, 5, 16);
        var level = Math.max(1, Math.min(10, Math.round(player.volume || 7)));
        for (var i = 0; i < 10; i++) {
            var height = 10 + i * 1.4;
            ctx.fillStyle = i < level ? '#2FD0C0' : 'rgba(255,255,255,0.20)';
            ctx.fillRect(106 + i * 7, 33 - height / 2, 4, height);
        }
        this.layer(session, 'jt-vol', this.vol, 250, 64, 985, 552, false); // inside the bar's hole
    }
    drawCaption(session, player) {
        if (!player.captionText) { this.remove(session, 'jt-caption'); return; }
        const ctx = this.caption.getContext('2d');
        ctx.globalAlpha = 1; ctx.clearRect(0, 0, 1000, 90);
        const words = String(player.captionText).split(' '), lines = []; let line = '';
        ctx.font = '26px ' + FONT;
        words.forEach(word => {
            const test = (line + ' ' + word).trim();
            if (ctx.measureText(test).width > 920 && line) { lines.push(line); line = word; }
            else line = test;
        });
        if (line) lines.push(line);
        const shown = lines.slice(0, 2);
        const height = 18 + shown.length * 32;
        rounded(ctx, 0, 80 - height, 1000, height, 14); ctx.fillStyle = 'rgba(2,10,13,0.74)'; ctx.fill();
        shown.forEach((entry, index) => text(ctx, entry, 500, 80 - height + 26 + index * 32, 26, 'rgba(255,255,255,0.97)', 'center', 'bold'));
        this.layer(session, 'jt-caption', this.caption, 1000, 90, 140, 455, { x: 140, y: 535 - height, width: 1000, height: height });
    }
    drawSettings(session, player) {
        if (!player.settingsOpen) { this.remove(session, 'jt-settings'); return; }
        const ctx = this.settings.getContext('2d');
        ctx.globalAlpha = 1; ctx.clearRect(0, 0, 680, 420);
        rounded(ctx, 0, 0, 680, 420, 26); ctx.fillStyle = 'rgba(7,21,27,0.97)'; ctx.fill();
        ctx.strokeStyle = 'rgba(47,208,192,0.46)'; ctx.lineWidth = 2; ctx.stroke();
        text(ctx, 'Playback settings', 340, 40, 28, '#FFFFFF', 'center', 'bold');
        const chip = (x, y, w, h, label, selected, disabled) => {
            rounded(ctx, x, y, w, h, 14); ctx.fillStyle = selected ? 'rgba(47,208,192,0.20)' : 'rgba(255,255,255,0.06)'; ctx.fill();
            ctx.strokeStyle = selected ? 'rgba(47,208,192,0.9)' : 'rgba(255,255,255,0.13)'; ctx.lineWidth = selected ? 2 : 1; ctx.stroke();
            text(ctx, label, x + w / 2, y + h / 2 + 1, 19, disabled ? 'rgba(255,255,255,0.38)' : selected ? '#FFFFFF' : 'rgba(220,238,242,0.86)', 'center', selected ? 'bold' : 'normal');
        };
        text(ctx, 'CAPTIONS', 40, 88, 16, 'rgba(126,156,166,1)', 'left', 'bold');
        chip(320, 65, 120, 46, 'Off', !player.captionsOn);
        chip(452, 65, 120, 46, 'On', player.captionsOn, player.captionsAvailable === false);
        if (player.captionsAvailable === false) text(ctx, 'No captions', 200, 88, 15, 'rgba(126,156,166,0.9)', 'left');
        text(ctx, 'LOOP', 40, 158, 16, 'rgba(126,156,166,1)', 'left', 'bold');
        chip(320, 135, 120, 46, 'Off', !player.loop);
        chip(452, 135, 120, 46, 'On', player.loop);
        text(ctx, 'AUTOPLAY', 40, 228, 16, 'rgba(126,156,166,1)', 'left', 'bold');
        chip(320, 205, 120, 46, 'Off', !player.autoplay);
        chip(452, 205, 120, 46, 'On', player.autoplay);
        text(ctx, 'QUALITY', 40, 300, 14, 'rgba(126,156,166,0.85)', 'left', 'bold');
        text(ctx, player.height ? player.height + 'p' : 'Auto', 40, 320, 17, 'rgba(200,225,232,0.9)', 'left');
        rounded(ctx, 240, 340, 200, 56, 14); ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
        text(ctx, 'Done', 340, 368, 21, '#FFFFFF', 'center', 'bold');
        this.layer(session, 'jt-settings', this.settings, 680, 420, 300, 150);
    }
    drawToast(session, player) {
        if (!player.toast) { this.remove(session, 'jt-toast'); return; }
        const ctx = this.toast.getContext('2d');
        ctx.clearRect(0, 0, 860, 64);
        rounded(ctx, 0, 4, 860, 56, 18); ctx.fillStyle = 'rgba(9,36,42,0.92)'; ctx.fill();
        ctx.fillStyle = 'rgba(47,208,192,1)'; ctx.fillRect(0, 12, 5, 40);
        text(ctx, ellipsis(ctx, player.toast, 800, 20), 28, 33, 20, 'rgba(236,250,252,0.96)', 'left', 'bold');
        this.layer(session, 'jt-toast', this.toast, 860, 64, 210, 116, { x: 210, y: 120, width: 860, height: 56 });
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
    // Every layer is a full RGBA image piped to the video host, so only layers
    // whose content changed are drawn: a blanket redraw cost up to 6 MB and a
    // third of a second of the renderer per tap. A new video session starts
    // with no layers and gets everything once. `force` only marks a moment
    // that must be current, such as the clock after a seek.
    update(session, player, force) {
        if (!session || !player) return;
        if (this.session !== session) { this.session = session; this.resend(); this.holesKey = ''; }
        const visible = player.controlsVisible !== false;
        const alpha = player.controlsAlpha == null ? 1 : player.controlsAlpha;
        if (!visible) {
            this.remove(session, 'jt-top'); this.remove(session, 'jt-bar'); this.remove(session, 'jt-time'); this.remove(session, 'jt-vol');
            delete this.keys.top; delete this.keys.bar; delete this.keys.vol; this.lastTime = 0;
        } else {
            const topKey = [player.id, player.title, player.channel, player.sponsorCount, alpha].join('|');
            if (this.keys.top !== topKey) { this.keys.top = topKey; this.drawTop(session, player); }
            const barKey = [player.id, player.paused, player.ended, player.nextTitle, alpha].join('|');
            if (this.keys.bar !== barKey) { this.keys.bar = barKey; this.drawBar(session, player); }
            const volKey = [player.id, player.volume, alpha].join('|');
            if (this.keys.vol !== volKey) { this.keys.vol = volKey; this.drawVolume(session, player); }
            const timeKey = [player.id, Math.floor(player.position || 0), player.duration, alpha].join('|');
            if (this.keys.time !== timeKey && (force || Date.now() - this.lastTime > 1000)) {
                this.keys.time = timeKey; this.lastTime = Date.now(); this.drawTime(session, player);
            }
        }
        const centerKey = [player.id, player.starting, player.paused, player.ended, player.nextTitle, player.autoplayIn, player.statusText].join('|');
        if (this.keys.center !== centerKey) { this.keys.center = centerKey; this.drawCenter(session, player); }
        const toastKey = [player.id, player.toast].join('|');
        if (this.keys.toast !== toastKey) { this.keys.toast = toastKey; this.drawToast(session, player); }
        const captionKey = [player.id, player.captionsOn, player.captionText].join('|');
        if (this.keys.caption !== captionKey) { this.keys.caption = captionKey; this.drawCaption(session, player); }
        const settingsKey = [player.id, player.settingsOpen, player.captionsOn, player.loop, player.autoplay, player.captionsAvailable].join('|');
        if (this.keys.settings !== settingsKey) { this.keys.settings = settingsKey; this.drawSettings(session, player); }
        this.flush(session);
    }
    reset() { this.keys = {}; this.lastTime = 0; }
}

module.exports = { Overlay: Overlay };
