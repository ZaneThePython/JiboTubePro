'use strict';

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const url = require('url');
const config = require('./config');
function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\uD800-\uDFFF\uFE0F\u200D\u2600-\u27BF]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit || 400);
}
function videoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}
function clamp(value, low, high) {
  value = Number(value);
  if (!isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}
function requestBuffer(target, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = url.parse(target);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      'User-Agent': config.userAgent,
      'Accept-Encoding': 'gzip'
    }, options.headers || {});
    if (options.body) headers['Content-Length'] = Buffer.isBuffer(options.body) ? options.body.length : Buffer.byteLength(options.body);
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.path,
      method: options.method || 'GET',
      headers: headers
    }, function (response) {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirects = Number(options.redirects || 0);
        if (redirects >= 5) {
          reject(new Error('too_many_redirects'));
          return;
        }
        resolve(requestBuffer(url.resolve(target, response.headers.location), Object.assign({}, options, {
          redirects: redirects + 1
        })));
        return;
      }
      const chunks = [];
      let stream = response;
      if (response.headers['content-encoding'] === 'gzip') stream = response.pipe(zlib.createGunzip());else if (response.headers['content-encoding'] === 'deflate') stream = response.pipe(zlib.createInflate());
      let size = 0;
      stream.on('data', function (chunk) {
        size += chunk.length;
        if (size > (options.maxBytes || 8 * 1024 * 1024)) {
          req.abort();
          stream.destroy();
          reject(new Error('response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', function () {
        const buffer = Buffer.concat(chunks);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error('http_' + response.statusCode + ' ' + buffer.toString('utf8').slice(0, 200));
          error.status = response.statusCode;
          reject(error);
          return;
        }
        resolve({
          buffer: buffer,
          headers: response.headers,
          status: response.statusCode
        });
      });
    });
    req.setTimeout(options.timeoutMs || config.requestTimeoutMs, function () {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
function fetchJson(target, options) {
  options = options || {};
  return requestBuffer(target, {
    method: options.method || 'GET',
    headers: Object.assign({
      'Accept': 'application/json'
    }, options.headers || {}),
    body: options.body,
    timeoutMs: options.timeoutMs
  }).then(function (response) {
    return JSON.parse(response.buffer.toString('utf8'));
  });
}
function fetchBuffer(target, options) {
  options = options || {};
  return requestBuffer(target, {
    headers: options.headers || {},
    timeoutMs: options.timeoutMs
  }).then(function (response) {
    return {
      buffer: response.buffer,
      contentType: response.headers['content-type'] || 'image/jpeg'
    };
  });
}
module.exports = {
  cleanText,
  videoId,
  clamp,
  requestBuffer,
  fetchJson,
  fetchBuffer
};
