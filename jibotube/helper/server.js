'use strict';

function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const config = require('./lib/config');
const home = require('./lib/home');
const stream = require('./lib/stream');
const {
  fetchBuffer,
  cleanText,
  videoId
} = require('./lib/util');
const VERSION = '2.0.0';
const THUMB_NAMES = new Set(['hqdefault', 'mqdefault', 'maxresdefault', 'hq720', 'sddefault']);
const THUMB_DIR = path.join(config.cacheDir, 'thumbs');
const PID_FILE = path.join(config.cacheDir, 'service.pid');
function ensureDir(directory) {
  if (fs.existsSync(directory)) return;
  const parent = path.dirname(directory);
  if (parent && parent !== directory && !fs.existsSync(parent)) ensureDir(parent);
  try {
    fs.mkdirSync(directory, 0o700);
  } catch (_) {}
}
ensureDir(THUMB_DIR);
const thumbCache = new (require('./lib/thumb-cache').Cache)(THUMB_DIR);
function tokenOk(request, query) {
  const provided = String(query.token || request.headers['x-jibotube-token'] || '');
  const expected = config.token;
  if (!expected || provided.length !== expected.length) return false;
  const a = Buffer.from(provided),
    b = Buffer.from(expected);
  if (typeof crypto.timingSafeEqual === 'function') {
    try {
      return crypto.timingSafeEqual(a, b);
    } catch (_) {
      return false;
    }
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function headers(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-JiboTube-Token, Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Cache-Control': 'no-store'
  }, extra || {});
}
function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }));
  response.end(body);
}
function sendError(response, status, code, detail) {
  sendJson(response, status, {
    error: code,
    detail: detail || ''
  });
}
function bodyOf(request) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    request.on('data', function (chunk) {
      size += chunk.length;
      if (size > 128 * 1024) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', function () {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('bad_json'));
      }
    });
    request.on('error', reject);
  });
}
function thumbnail(_x, _x2) {
  return _thumbnail.apply(this, arguments);
}
function _thumbnail() {
  _thumbnail = _asyncToGenerator(function* (id, name) {
    const cacheName = id + '-' + name + '.jpg';
    const cached = thumbCache.get(cacheName);
    if (cached) return {
      file: cached,
      type: 'image/jpeg'
    };
    const order = name === 'maxresdefault' ? ['maxresdefault', 'hq720', 'hqdefault'] : [name, 'hq720', 'hqdefault'];
    let lastError = null;
    for (let i = 0; i < order.length; i++) {
      try {
        const result = yield fetchBuffer('https://i.ytimg.com/vi/' + id + '/' + order[i] + '.jpg', {
          timeoutMs: 12000
        });
        if (!result.buffer || result.buffer.length < 512) throw new Error('thumb_empty');
        const file = thumbCache.put(cacheName, result.buffer);
        return {
          file: file,
          type: result.contentType || 'image/jpeg'
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('thumb_failed');
  });
  return _thumbnail.apply(this, arguments);
}
function streamFile(request, response, file, start, end, type) {
  const stat = fs.statSync(file);
  const from = Math.max(0, Number(start) || 0);
  const to = end === undefined || end === null ? stat.size - 1 : Math.min(stat.size - 1, Number(end));
  if (from > to || from >= stat.size) {
    response.writeHead(416, headers({
      'Content-Range': 'bytes */' + stat.size
    }));
    response.end();
    return;
  }
  const length = to - from + 1;
  response.writeHead(from > 0 || to < stat.size - 1 ? 206 : 200, headers({
    'Content-Type': type || 'image/jpeg',
    'Content-Length': length,
    'Accept-Ranges': 'bytes',
    'Content-Range': 'bytes ' + from + '-' + to + '/' + stat.size
  }));
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(file, {
    start: from,
    end: to
  }).on('error', function () {
    response.destroy();
  }).pipe(response);
}
function handle(_x3, _x4) {
  return _handle.apply(this, arguments);
}
function _handle() {
  _handle = _asyncToGenerator(function* (request, response) {
    const parsed = url.parse(request.url, true);
    let pathname;
    try {
      pathname = decodeURIComponent(parsed.pathname);
    } catch (_) {
      return sendError(response, 400, 'bad_path');
    }
    const query = parsed.query || {};
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers());
      response.end();
      return;
    }
    if (pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'jibotube',
        version: VERSION,
        streaming: true,
        node: process.version,
        sponsorBlock: config.sponsorBlock
      });
    }
    if (!tokenOk(request, query)) return sendError(response, 401, 'unauthorized');
    if (request.method === 'GET' && pathname === '/api/home') {
      const history = [];
      const likes = [];
      try {
        const raw = query.history || '';
        raw.split(',').forEach(function (part) {
          if (videoId(part)) history.push({
            id: part
          });
        });
        (query.likes || '').split(',').forEach(function (part) {
          if (videoId(part)) likes.push(part);
        });
      } catch (_) {}
      return sendJson(response, 200, yield home.home({
        history: history,
        likes: likes
      }));
    }
    if (request.method === 'POST' && pathname === '/api/home') {
      let body;
      try {
        body = yield bodyOf(request);
      } catch (error) {
        return sendError(response, 400, error.message);
      }
      return sendJson(response, 200, yield home.home(body || {}));
    }
    if (pathname === '/api/music/home') {
      let body = {};
      if (request.method === 'POST') {
        try {
          body = yield bodyOf(request);
        } catch (error) {
          return sendError(response, 400, error.message);
        }
      } else if (request.method !== 'GET') {
        return sendError(response, 405, 'method_not_allowed');
      }
      return sendJson(response, 200, yield home.musicHome(body || {}));
    }
    if (request.method === 'GET' && pathname === '/api/music/search') {
      const text = cleanText(query.q || '', 160);
      if (!text) return sendError(response, 400, 'query_required');
      return sendJson(response, 200, yield home.musicSearch(text));
    }
    if (request.method === 'GET' && pathname === '/api/search') {
      const text = cleanText(query.q || '', 160);
      if (!text) return sendError(response, 400, 'query_required');
      return sendJson(response, 200, yield home.search(text));
    }
    const videoMatch = /^\/api\/video\/([A-Za-z0-9_-]{11})$/.exec(pathname);
    if (request.method === 'GET' && videoMatch) {
      try {
        return sendJson(response, 200, yield home.details(videoMatch[1]));
      } catch (error) {
        return sendError(response, 502, 'video_unavailable', String(error.message || error));
      }
    }
    const streamMatch = /^\/api\/stream\/([A-Za-z0-9_-]{11})$/.exec(pathname);
    if (request.method === 'GET' && streamMatch) {
      try {
        return sendJson(response, 200, yield stream.info(streamMatch[1], Number(query.t || 0), query.snap));
      } catch (error) {
        return sendError(response, 502, 'stream_unavailable', String(error.message || error));
      }
    }
    const proxyMatch = /^\/stream\/([A-Za-z0-9_-]{11})\/(video|audio)$/.exec(pathname);
    if ((request.method === 'GET' || request.method === 'HEAD') && proxyMatch) {
      try {
        return yield stream.proxy(proxyMatch[1], proxyMatch[2], Number(query.frag || 0), Number(query.t || 0), request, response);
      } catch (error) {
        if (!response.headersSent) return sendError(response, 502, 'stream_unavailable', String(error.message || error));
        try {
          response.destroy();
        } catch (_) {}
        return;
      }
    }
    const captionsMatch = /^\/api\/captions\/([A-Za-z0-9_-]{11})$/.exec(pathname);
    if (request.method === 'GET' && captionsMatch) {
      try {
        return sendJson(response, 200, {
          id: captionsMatch[1],
          cues: yield stream.captions(captionsMatch[1])
        });
      } catch (_) {
        return sendJson(response, 200, {
          id: captionsMatch[1],
          cues: []
        });
      }
    }
    const thumbMatch = /^\/thumb\/([A-Za-z0-9_-]{11})\.jpg$/.exec(pathname);
    if (request.method === 'GET' && thumbMatch) {
      const name = THUMB_NAMES.has(query.q || '') ? query.q : 'hq720';
      try {
        const thumb = yield thumbnail(thumbMatch[1], name);
        return streamFile(request, response, thumb.file, 0, null, thumb.type);
      } catch (error) {
        return sendError(response, 404, 'thumb_unavailable');
      }
    }
    if (pathname === '/shutdown') {
      sendJson(response, 200, {
        ok: true
      });
      setTimeout(function () {
        stop();
        process.exit(0);
      }, 100);
      return;
    }
    return sendError(response, 404, 'not_found');
  });
  return _handle.apply(this, arguments);
}
let server = null;
let sockets = [];
function start() {
  if (server) return server;
  sockets = [];
  try {
    fs.writeFileSync(PID_FILE, String(process.pid) + '\n');
  } catch (_) {}
  server = http.createServer(function (request, response) {
    handle(request, response).catch(function (error) {
      try {
        sendError(response, 500, 'internal', String(error && error.message || error));
      } catch (_) {}
    });
  });
  server.on('connection', function (socket) {
    sockets.push(socket);
    socket.on('close', function () {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
  });
  server.on('error', function (error) {
    process.stdout.write('jibotube service error ' + String(error && error.message || error) + '\n');
  });
  server.listen(config.port, config.host, function () {
    process.stdout.write('jibotube service ' + VERSION + ' listening on http://' + config.host + ':' + config.port + '\n');
    process.stdout.write('cache ' + config.cacheDir + '\n');
    process.stdout.write('token ' + (process.env.JIBOTUBE_TOKEN ? 'from env' : 'from file') + '\n');
  });
  return server;
}
function stop() {
  const current = server;
  server = null;
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {}
  if (current) {
    try {
      current.close();
    } catch (_) {}
  }
  const open = sockets.slice();
  sockets = [];
  open.forEach(function (socket) {
    try {
      socket.destroy();
    } catch (_) {}
  });
}
process.on('exit', function () {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {}
});
module.exports = {
  start: start,
  stop: stop
};
