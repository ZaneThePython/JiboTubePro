'use strict';

function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
const yt = require('./yt');
const relatedApi = require('./related');
const sponsor = require('./sponsorblock');
const {
  cleanText,
  videoId
} = require('./util');
const CATEGORY_ROWS = [{
  id: 'trending',
  title: 'Trending now',
  query: 'popular this week',
  limit: 14
}, {
  id: 'music',
  title: 'Music',
  query: 'music video',
  limit: 14
}, {
  id: 'gaming',
  title: 'Gaming',
  query: 'gaming',
  limit: 14
}, {
  id: 'news',
  title: 'News',
  query: 'news today',
  limit: 14
}, {
  id: 'learning',
  title: 'Learning',
  query: 'explained science documentary',
  limit: 14
}, {
  id: 'comedy',
  title: 'Comedy',
  query: 'comedy sketch',
  limit: 14
}, {
  id: 'movies',
  title: 'Movies & trailers',
  query: 'official movie trailer',
  limit: 14
}, {
  id: 'technology',
  title: 'Technology',
  query: 'technology review',
  limit: 14
}];
const STOP = new Set(('the a an and or of to in on for with from by at is are was were be been this that it its as how why what ' + 'official video full new best top vs my your you i we they he she his her our all more most about into over under after before ' + 'part feat ft remaster remastered live lyrics lyric hd 4k 8k').split(' '));
const MUSIC_ROWS = [{
  id: 'music-charts',
  title: 'Charts',
  query: 'top songs this week',
  limit: 14
}, {
  id: 'music-new',
  title: 'New music',
  query: 'new music releases',
  limit: 14
}, {
  id: 'music-mix',
  title: 'Made for you',
  query: 'music mix',
  limit: 14
}, {
  id: 'music-pop',
  title: 'Pop',
  query: 'pop songs',
  limit: 14
}, {
  id: 'music-hiphop',
  title: 'Hip-Hop',
  query: 'hip hop songs',
  limit: 14
}, {
  id: 'music-rock',
  title: 'Rock',
  query: 'rock songs',
  limit: 14
}, {
  id: 'music-electronic',
  title: 'Electronic',
  query: 'electronic music',
  limit: 14
}, {
  id: 'music-chill',
  title: 'Chill',
  query: 'chill music',
  limit: 14
}];
const musicCache = new Map();
function musicItem(item) {
  return Object.assign({}, item, {
    music: true
  });
}
const homeCache = new Map();
function tokens(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !STOP.has(word)).slice(0, 12);
}
function score(candidate, weights) {
  const words = tokens(candidate.title);
  let result = Math.log10(1 + (candidate.views || 0)) * 0.35;
  words.forEach(word => {
    result += (weights[word] || 0) * 1.6;
  });
  if (candidate.channelId && weights['channel:' + candidate.channelId]) result += weights['channel:' + candidate.channelId] * 3;
  if (candidate.published) {
    const digits = String(candidate.published).replace(/\D/g, '');
    const year = Number(digits.slice(0, 4));
    if (year >= new Date().getFullYear() - 1) result += 0.6;
  }
  return result;
}
function mergeUnique(lists, seen) {
  const out = [];
  lists.forEach(list => (list || []).forEach(item => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  }));
  return out;
}
function enrich(item, extra) {
  return Object.assign({}, item, extra || {});
}
function popular(_x) {
  return _popular.apply(this, arguments);
}
function _popular() {
  _popular = _asyncToGenerator(function* (category) {
    const items = yield yt.search(category.query, category.limit);
    return items.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
  });
  return _popular.apply(this, arguments);
}
function signature(history, likes) {
  return (history || []).map(item => item && item.id + ':' + (item.position || 0) + ':' + (item.duration || 0)).filter(Boolean).slice(-8).join(',') + '|' + (likes || []).filter(Boolean).slice(-8).join(',');
}
function home(_x2) {
  return _home.apply(this, arguments);
}
function _home() {
  _home = _asyncToGenerator(function* (input) {
    const history = (input && input.history || []).filter(item => item && videoId(item.id)).slice(-20);
    const likes = (input && input.likes || []).filter(videoId).slice(-20);
    const searches = (input && input.searches || []).map(value => cleanText(value, 80)).filter(Boolean).slice(-8);
    const key = signature(history, likes) + '|' + searches.join(',');
    const hit = homeCache.get(key);
    if (hit && Date.now() - hit.at < 4 * 60 * 1000) return hit.value;
    const seen = new Set();
    const rows = [];
    const continueItems = history.filter(item => Number(item.position) > 8 && (!item.duration || Number(item.position) < Number(item.duration) - 8)).slice(-6).reverse();
    let recentInfo = [];
    if (history.length || likes.length) {
      const ids = history.slice().reverse().map(item => item.id).concat(likes).filter(videoId);
      const unique = [];
      ids.forEach(id => {
        if (unique.indexOf(id) < 0) unique.push(id);
      });
      recentInfo = (yield Promise.all(unique.slice(0, 3).map(id => yt.video(id).catch(() => null)))).filter(Boolean);
    }
    const weights = {};
    recentInfo.forEach((info, index) => {
      const weight = 1 - index * 0.2;
      tokens(info.title).forEach(word => {
        weights[word] = (weights[word] || 0) + weight;
      });
      if (info.channelId) weights['channel:' + info.channelId] = (weights['channel:' + info.channelId] || 0) + weight;
      (searches || []).forEach(query => tokens(query).forEach(word => {
        weights[word] = (weights[word] || 0) + 0.35;
      }));
    });
    const jobs = [];
    jobs.push(popular(CATEGORY_ROWS[0]).catch(() => []));
    recentInfo.slice(0, 2).forEach(info => jobs.push(relatedApi.related(info.id).catch(() => [])));
    CATEGORY_ROWS.slice(1, 5).forEach(category => jobs.push(popular(category).catch(() => [])));
    if (recentInfo[0] && recentInfo[0].channel) jobs.push(yt.channelVideos(recentInfo[0].channel, 8).catch(() => []));
    const results = yield Promise.all(jobs);
    let cursor = 0;
    const trending = results[cursor++] || [];
    const relatedLists = recentInfo.slice(0, 2).map(() => results[cursor++] || []);
    const categories = CATEGORY_ROWS.slice(1, 5).map(category => ({
      category: category,
      items: results[cursor++] || []
    }));
    const channelItems = recentInfo[0] && recentInfo[0].channel ? results[cursor++] || [] : [];
    if (continueItems.length) {
      const items = continueItems.map(item => {
        const duration = Number(item.duration) || 0;
        return enrich(item, {
          id: item.id,
          title: cleanText(item.title || 'Continue watching', 220),
          channel: cleanText(item.channel || '', 120),
          thumb: yt.thumbPath(item.id),
          duration: duration,
          position: Number(item.position) || 0,
          progress: duration ? Math.min(1, Number(item.position) / duration) : 0
        });
      });
      rows.push({
        id: 'continue',
        title: 'Continue watching',
        items: items
      });
    }
    const recommended = mergeUnique(relatedLists, seen);
    if (recommended.length) {
      recommended.sort((a, b) => score(b, weights) - score(a, weights));
      rows.push({
        id: 'foryou',
        title: 'Recommended for you',
        items: recommended.slice(0, 14)
      });
    }
    if (channelItems.length && recentInfo[0]) {
      const items = channelItems.map(item => enrich(item, {
        channel: item.channel || recentInfo[0].channel || ''
      }));
      rows.push({
        id: 'channel',
        title: 'New from ' + cleanText(recentInfo[0].channel || 'your favorite channel', 40),
        items: items
      });
    }
    if (relatedLists[0] && relatedLists[0].length) {
      rows.push({
        id: 'because',
        title: 'Because you watched ' + cleanText(recentInfo[0].title, 46),
        items: relatedLists[0].slice(0, 12)
      });
    }
    if (trending.length) rows.push({
      id: 'trending',
      title: CATEGORY_ROWS[0].title,
      items: trending
    });
    categories.forEach(entry => {
      if (entry.items.length) rows.push({
        id: entry.category.id,
        title: entry.category.title,
        items: entry.items
      });
    });
    const value = {
      rows: rows.slice(0, 9),
      history: history.slice(-8),
      likes: likes,
      searches: searches,
      updatedAt: new Date().toISOString()
    };
    homeCache.set(key, {
      at: Date.now(),
      value
    });
    if (homeCache.size > 40) homeCache.delete(homeCache.keys().next().value);
    return value;
  });
  return _home.apply(this, arguments);
}
function search(_x3) {
  return _search.apply(this, arguments);
}
function _search() {
  _search = _asyncToGenerator(function* (query) {
    query = cleanText(query, 160);
    if (!query) return {
      query: '',
      items: []
    };
    let items = yield yt.search(query, 24);
    if (!items.length) items = yield yt.search(query.split(/\s+/).slice(0, 4).join(' '), 16);
    return {
      query: query,
      items: items
    };
  });
  return _search.apply(this, arguments);
}
function details(_x4, _x5) {
  return _details.apply(this, arguments);
}
function _details() {
  _details = _asyncToGenerator(function* (id, options) {
    const info = yield yt.video(id);
    let related = yield relatedApi.related(id);
    if (!related.length) {
      const words = tokens(info.title).slice(0, 4).join(' ');
      // Recommendations are optional; a failed search must not veto the
      // independently fetched playable video (including Library/Resume).
      related = yield yt.search(words || info.channel || 'popular', 16).catch(() => []);
    }
    const segments = yield sponsor.segments(id, info.duration);
    const rows = [];
    if (related.length) rows.push({
      id: 'related',
      title: 'Up next',
      items: related.slice(0, 14)
    });
    if (info.channelId) {
      const channel = yield yt.channelVideos(info.channel, 8).catch(() => []);
      if (channel.length) rows.push({
        id: 'channel',
        title: 'More from ' + info.channel,
        items: channel.map(item => enrich(item, {
          channel: item.channel || info.channel
        }))
      });
    }
    return {
      video: info,
      related: related,
      rows: rows,
      sponsor: {
        enabled: true,
        segments: segments
      },
      stream: '/api/stream/' + info.id
    };
  });
  return _details.apply(this, arguments);
}
function musicSearch(_x6) {
  return _musicSearch.apply(this, arguments);
}
function _musicSearch() {
  _musicSearch = _asyncToGenerator(function* (query) {
    query = cleanText(query, 160);
    if (!query) return {
      query: '',
      items: [],
      music: true
    };
    const terms = /music|song|songs|album|artist|lyrics|remix|track/i;
    const q = terms.test(query) ? query : query + ' music';
    let items = yield yt.search(q, 24);
    if (!items.length) items = yield yt.search(query, 24);
    return {
      query: query,
      items: items.map(musicItem),
      music: true
    };
  });
  return _musicSearch.apply(this, arguments);
}
function musicHome(_x7) {
  return _musicHome.apply(this, arguments);
}
function _musicHome() {
  _musicHome = _asyncToGenerator(function* (input) {
    const history = (input && input.history || []).filter(item => item && videoId(item.id)).slice(-20);
    const musicHistory = history.filter(item => item.music === true);
    const likes = (input && input.likes || []).filter(videoId).slice(-20);
    const searches = (input && input.searches || []).map(value => cleanText(value, 80)).filter(Boolean).slice(-8);
    const key = signature(history, likes) + '|music|' + searches.join(',');
    const hit = musicCache.get(key);
    if (hit && Date.now() - hit.at < 4 * 60 * 1000) return hit.value;
    const seen = new Set();
    const rows = [];
    let mixItems = [];
    if (musicHistory.length) {
      const recent = musicHistory.slice().reverse().slice(0, 2);
      const lists = yield Promise.all(recent.map(item => relatedApi.related(item.id).catch(() => [])));
      const weighted = {};
      lists.forEach(list => list.forEach(item => {
        weighted[item.id] = (weighted[item.id] || 0) + 1;
      }));
      mixItems = mergeUnique(lists, seen).sort((a, b) => (weighted[b.id] || 0) - (weighted[a.id] || 0)).map(musicItem);
    }
    const jobs = MUSIC_ROWS.map(row => popular(row).catch(() => []));
    const results = yield Promise.all(jobs);
    let cursor = 0;
    const charts = (results[cursor++] || []).map(musicItem);
    const fresh = (results[cursor++] || []).map(musicItem);
    const fallbackMix = (results[cursor++] || []).map(musicItem);
    const genres = results.slice(cursor).map((items, index) => ({
      row: MUSIC_ROWS[cursor + index],
      items: items.map(musicItem)
    }));
    if (charts.length) rows.push({
      id: 'music-charts',
      title: 'Charts',
      items: charts
    });
    if (fresh.length) rows.push({
      id: 'music-new',
      title: 'New music',
      items: fresh
    });
    const mix = (mixItems.length ? mixItems : fallbackMix).slice(0, 14);
    if (mix.length) rows.push({
      id: 'music-mix',
      title: 'Made for you',
      items: mix
    });
    genres.forEach(entry => {
      if (entry.items.length) rows.push({
        id: entry.row.id,
        title: entry.row.title,
        items: entry.items
      });
    });
    const value = {
      rows: rows.slice(0, 10),
      music: true,
      history: history.slice(-8),
      likes: likes,
      searches: searches,
      updatedAt: new Date().toISOString()
    };
    musicCache.set(key, {
      at: Date.now(),
      value
    });
    if (musicCache.size > 40) musicCache.delete(musicCache.keys().next().value);
    return value;
  });
  return _musicHome.apply(this, arguments);
}
module.exports = {
  home,
  musicHome,
  search,
  musicSearch,
  details,
  tokens,
  CATEGORY_ROWS,
  MUSIC_ROWS
};
