'use strict';

function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
const config = require('./config');
const {
  fetchJson,
  videoId
} = require('./util');
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
const merge = require('./merge').merge;
function segments(_x, _x2) {
  return _segments.apply(this, arguments);
}
function _segments() {
  _segments = _asyncToGenerator(function* (id, duration) {
    id = videoId(id);
    if (!id || !config.sponsorBlock || !config.sponsorCategories.length) return [];
    const key = id + ':' + Math.round(duration || 0);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.segments;
    const url = 'https://sponsor.ajay.app/api/skipSegments?videoID=' + encodeURIComponent(id) + '&categories=' + encodeURIComponent(JSON.stringify(config.sponsorCategories));
    let data = [];
    try {
      data = yield fetchJson(url, {
        timeoutMs: 12000
      });
    } catch (error) {
      if (error.status === 404) data = [];else return [];
    }
    const result = merge(Array.isArray(data) ? data.filter(item => item.actionType === 'skip') : [], duration);
    cache.set(key, {
      at: Date.now(),
      segments: result
    });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return result;
  });
  return _segments.apply(this, arguments);
}
module.exports = {
  segments,
  merge
};
