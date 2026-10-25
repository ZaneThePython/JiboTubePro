'use strict';

function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
const config = require('./config');
const {
  fetchJson,
  cleanText,
  videoId
} = require('./util');
const {
  thumbPath
} = require('./yt');
const TTL_MS = 15 * 60 * 1000;
const cache = new Map();
function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map(run => run.text || '').join('');
  return '';
}
function parseDuration(text) {
  const parts = String(text || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(value => !isFinite(value))) return 0;
  return parts.reduce((total, value) => total * 60 + value, 0);
}
function parseCount(text) {
  const match = /([\d.,]+)\s*([KMB])?/i.exec(String(text || '').replace(/,/g, ''));
  if (!match) return 0;
  const base = Number(match[1]);
  if (!isFinite(base)) return 0;
  const suffix = (match[2] || '').toUpperCase();
  return Math.round(base * (suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1));
}
function fromLockup(lockup) {
  if (!lockup || typeof lockup !== 'object') return null;
  const metadata = lockup.metadata && lockup.metadata.lockupMetadataViewModel;
  if (!metadata) return null;
  const command = lockup.rendererContext && lockup.rendererContext.commandContext && lockup.rendererContext.commandContext.onTap && lockup.rendererContext.commandContext.onTap.innertubeCommand;
  let id = command && command.watchEndpoint && videoId(command.watchEndpoint.videoId);
  if (!id) {
    const sources = lockup.contentImage && lockup.contentImage.thumbnailViewModel && lockup.contentImage.thumbnailViewModel.image && lockup.contentImage.thumbnailViewModel.image.sources || [];
    const url = sources.length ? sources[sources.length - 1].url : '';
    const match = /\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//.exec(url || '');
    if (match) id = match[1];
  }
  if (!id) return null;
  let duration = 0,
    views = 0,
    published = '';
  const rows = metadata.metadata && metadata.metadata.contentMetadataViewModel && metadata.metadata.contentMetadataViewModel.metadataRows || [];
  rows.forEach(row => {
    (row.metadataParts || []).forEach(part => {
      const text = textOf(part.text);
      const label = part.accessibilityLabel || '';
      if (/^\d+:\d\d(:\d\d)?$/.test(text)) duration = Math.max(duration, parseDuration(text));else if (/view/i.test(label) || /\bviews?\b/i.test(text)) views = Math.max(views, parseCount(text));else if (/ago$|^Streamed|^Premiered/.test(text)) published = text;
    });
  });
  const overlays = lockup.contentImage && lockup.contentImage.thumbnailViewModel && lockup.contentImage.thumbnailViewModel.overlays || [];
  overlays.forEach(overlay => {
    const badges = overlay.thumbnailBottomOverlayViewModel && overlay.thumbnailBottomOverlayViewModel.badges || [];
    badges.forEach(badge => {
      const value = badge.thumbnailBadgeViewModel && badge.thumbnailBadgeViewModel.text;
      if (/^\d+:\d\d(:\d\d)?$/.test(value || '')) duration = Math.max(duration, parseDuration(value));
    });
  });
  let channel = '';
  const first = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0];
  if (first) channel = textOf(first.text);
  return {
    id,
    title: cleanText(textOf(metadata.title), 220),
    channel: cleanText(channel, 120),
    channelId: '',
    duration,
    views,
    published,
    live: false,
    thumb: thumbPath(id)
  };
}
function fromCompact(renderer) {
  if (!renderer || typeof renderer !== 'object') return null;
  const id = videoId(renderer.videoId);
  if (!id) return null;
  return {
    id,
    title: cleanText(textOf(renderer.title), 220),
    channel: cleanText(textOf(renderer.longBylineText) || textOf(renderer.shortBylineText), 120),
    channelId: renderer.channelId || renderer.longBylineText && renderer.longBylineText.runs && renderer.longBylineText.runs[0] && renderer.longBylineText.runs[0].navigationEndpoint && renderer.longBylineText.runs[0].navigationEndpoint.browseEndpoint && renderer.longBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId || '',
    duration: parseDuration(textOf(renderer.lengthText)),
    views: parseCount(textOf(renderer.shortViewCountText) || textOf(renderer.viewCountText)),
    published: cleanText(textOf(renderer.publishedTimeText), 40),
    live: textOf(renderer.lengthText) === 'LIVE',
    thumb: thumbPath(id)
  };
}
function collect(value, out) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collect(item, out));
    return;
  }
  if (value.lockupViewModel) {
    const item = fromLockup(value.lockupViewModel);
    if (item) out.push(item);
  }
  if (value.compactVideoRenderer) {
    const item = fromCompact(value.compactVideoRenderer);
    if (item) out.push(item);
  }
  if (value.videoRenderer) {
    const item = fromCompact(value.videoRenderer);
    if (item) out.push(item);
  }
  Object.keys(value).forEach(key => {
    if (key !== 'lockupViewModel' && key !== 'compactVideoRenderer' && key !== 'videoRenderer') collect(value[key], out);
  });
}
function related(_x) {
  return _related.apply(this, arguments);
}
function _related() {
  _related = _asyncToGenerator(function* (id) {
    id = videoId(id);
    if (!id) return [];
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
    const body = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US'
        }
      },
      videoId: id
    });
    let data;
    try {
      data = yield fetchJson('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body,
        timeoutMs: 15000
      });
    } catch (_) {
      return [];
    }
    const results = [];
    const secondary = data && data.contents && data.contents.twoColumnWatchNextResults && data.contents.twoColumnWatchNextResults.secondaryResults;
    if (secondary) collect(secondary, results);
    if (!results.length) collect(data && data.contents, results);
    const seen = new Set([id]);
    const items = results.filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 24);
    cache.set(id, {
      at: Date.now(),
      items
    });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return items;
  });
  return _related.apply(this, arguments);
}
module.exports = {
  related,
  parseDuration,
  parseCount
};
