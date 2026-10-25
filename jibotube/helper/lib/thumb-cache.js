'use strict';

// Thumbnail data is optional. Never allow it to grow with viewing history.
var fs = require('fs'),
  path = require('path');
function Cache(directory, maxBytes, maxEntries, maxFile) {
  this.directory = directory;
  this.maxBytes = maxBytes || 16 * 1024 * 1024;
  this.maxEntries = maxEntries || 128;
  this.maxFile = maxFile || 512 * 1024;
  try {
    this.trim(0, 0);
  } catch (e) {/* optional cache may be missing, full or read-only */}
}
Cache.prototype.file = function (name) {
  if (!/^[A-Za-z0-9_-]+\.jpg$/.test(name)) throw Error('thumbnail_name_invalid');
  return path.join(this.directory, name);
};
Cache.prototype.get = function (name) {
  var file = this.file(name);
  try {
    var s = fs.lstatSync(file);
    if (s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= this.maxFile) return file;
  } catch (e) {}
  return null;
};
Cache.prototype.trim = function (room, count) {
  var self = this,
    total = 0,
    files = [];
  fs.readdirSync(this.directory).forEach(function (name) {
    var file = path.join(self.directory, name),
      s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) return;
    if (!/^[A-Za-z0-9_-]+\.jpg$/.test(name) || s.size > self.maxFile) {
      fs.unlinkSync(file);
      return;
    }
    total += s.size;
    files.push({
      file: file,
      size: s.size,
      time: s.mtime.getTime()
    });
  });
  files.sort(function (a, b) {
    return a.time - b.time || a.file.localeCompare(b.file);
  });
  while (files.length && (total + room > this.maxBytes || files.length + count > this.maxEntries)) {
    var old = files.shift();
    fs.unlinkSync(old.file);
    total -= old.size;
  }
};
Cache.prototype.put = function (name, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > this.maxFile || bytes.length > this.maxBytes) throw Error('thumbnail_too_large');
  var file = this.file(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  this.trim(bytes.length, 1);
  fs.writeFileSync(file, bytes, {
    mode: 384,
    flag: 'wx'
  });
  return file;
};
exports.Cache = Cache;
