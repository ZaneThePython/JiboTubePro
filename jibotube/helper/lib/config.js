'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
function readToken() {
  if (process.env.JIBOTUBE_TOKEN) return process.env.JIBOTUBE_TOKEN.trim();
  const file = env('JIBOTUBE_TOKEN_FILE', path.join(os.homedir(), '.config', 'jibotube', 'token'));
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  } catch (_) {}
  const directory = path.dirname(file);
  try {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, 0o700);
    const token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(file, token + '\n', {
      mode: 0o600
    });
    return token;
  } catch (_) {
    return crypto.randomBytes(24).toString('hex');
  }
}
const config = {
  port: Number(env('JIBOTUBE_PORT', 18700)),
  host: env('JIBOTUBE_HOST', '127.0.0.1'),
  token: readToken(),
  cacheDir: env('JIBOTUBE_CACHE_DIR', path.join(os.homedir(), '.cache', 'jibotube')),
  maxHeight: Number(env('JIBOTUBE_MAX_HEIGHT', 480)),
  maxFps: Number(env('JIBOTUBE_MAX_FPS', 30)),
  maxSearch: Number(env('JIBOTUBE_MAX_SEARCH', 24)),
  sponsorBlock: env('JIBOTUBE_SPONSORBLOCK', '1') !== '0',
  sponsorCategories: env('JIBOTUBE_SPONSOR_CATEGORIES', 'sponsor,selfpromo,interaction,intro,outro,preview,music_offtopic,filler').split(',').map(s => s.trim()).filter(Boolean),
  requestTimeoutMs: Number(env('JIBOTUBE_REQUEST_TIMEOUT_MS', 25000)),
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
};
config.cacheDir = path.resolve(config.cacheDir);
module.exports = config;
