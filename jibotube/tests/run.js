'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const vm = require('vm'), EventEmitter = require('events'), child = require('child_process');
const app = path.resolve(__dirname, '..'), root = path.dirname(app);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jibotube-test-'));
process.env.JIBOTUBE_DATA_DIR = path.join(temp, 'data');
function load(file, overrides) {
    const filename = path.join(app, file), result = { exports: {} };
    const factory = vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + fs.readFileSync(filename, 'utf8') + '\n})', { filename: filename });
    factory(name => overrides && Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : require(name[0] === '.' ? path.resolve(path.dirname(filename), name) : name), result, result.exports, filename, path.dirname(filename));
    return result.exports;
}
function signal() {
    const handlers = [];
    return { on: fn => handlers.push(fn), off: fn => { const at = handlers.indexOf(fn); if (at >= 0) handlers.splice(at, 1); },
        fire: () => handlers.slice().forEach(fn => fn()), count: () => handlers.length };
}
function syntax(dir) {
    fs.readdirSync(dir).forEach(name => {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) syntax(file);
        else if (/\.js$/.test(name)) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    });
}
function request(route, token) {
    return new Promise((resolve, reject) => {
        const req = require('http').get({ hostname: '127.0.0.1', port: 18700, path: route, headers: { 'X-JiboTube-Token': token || '' } }, res => {
            let data = ''; res.on('data', b => { data += b; });
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
        });
        req.on('error', reject); req.setTimeout(2000, () => { req.abort(); reject(Error('request timeout')); });
    });
}
function remove(dir) {
    fs.readdirSync(dir).forEach(name => { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) remove(file); else fs.unlinkSync(file); }); fs.rmdirSync(dir);
}
syntax(app);
assert.strictEqual(require(path.join(root, 'manifest.json')).type, 'skill');
assert.strictEqual(require(path.join(app, 'package.json')).name, '@be/jibotube');
assert(fs.readFileSync(path.join(app, 'launch.rule'), 'utf8').indexOf('\\@be/jibotube') >= 0);
const Store = require('../store').Store;
const item = { id: 'abcdefghijk', title: 'Test video', duration: 200 };
let store = new Store(); store.watched(item, 42); store.like(item); store.search('test'); store.setCaptions(true);
store = new Store(); assert.strictEqual(store.state.history[0].position, 42); assert(store.liked(item.id)); assert(store.state.settings.captions);
store.clearHistory(); assert.strictEqual(new Store().state.history.length, 0);
console.log('PASS Node syntax, package metadata, persistent library');
const diagnostics = require('../diagnostics');
assert.strictEqual(diagnostics.message({ detail: 'x_no_cookie' }), 'Cannot open the video display');
assert.strictEqual(diagnostics.message({ detail: 'WARNING: erroneous pipeline: no element "omxh264dec"' }), 'A video playback component is missing');
const secret = 'a'.repeat(48);
const safe = diagnostics.clean('http://localhost/stream?token=' + secret + ' token=' + secret);
assert(safe.indexOf(secret) < 0); assert(safe.indexOf('http://') < 0);
console.log('PASS credential redaction');
require('./formats-frames')();
console.log('PASS default/English audio, video resolution/FPS caps, and decoded-frame uploads');
require('./buffered-media')();
console.log('PASS explicit MP4 buffering, byte order, backpressure, memory trimming, network failure, and cleanup');

const events = { hjHeard: signal(), touchOn: signal(), hatchOpen: signal() };
const views = { ActionData: { CALLBACK: 'callback' }, GESTURE: { SWIPE_DOWN: 'down' }, TRANSITION: { IN: 'in', OUT: 'out' },
    _viewProcess: { active: false }, viewStackLength: 1,
    createView: () => ({ state: 'opened', addAction: function (type, data) { this.swipe = data.callback; } }),
    changeView: function (options, done, fail, decorate) {
        if (options.remove) { this.currentView.state = 'destroyed'; this.currentView = null; }
        else { this.currentView = options.addView; if (decorate) decorate(); }
        done();
    } };
const jibo = { face: { views: views }, jetstream: { events: { hjHeard: events.hjHeard } }, system: { events: { touchOn: events.touchOn, hatchOpen: events.hatchOpen } } };
class Base { exit() { this.exits = (this.exits || 0) + 1; } destroy(done) { done(); } }
class UI { config() { return {}; } decorate() {} render() {} releaseArt() { this.released = true; } }
const videoStub = { shutdown: () => Promise.resolve() };
const serviceStub = { settings: () => ({ base: 'http://127.0.0.1:18700', token: 'test' }), ensure: () => Promise.resolve(true), stop: () => Promise.resolve() };
const Skill = load('index.js', { jibo: jibo, '@be/be-framework': { BeSkill: Base }, './video': videoStub, './service': serviceStub, './ui': { UI: UI } });
global.PIXI = {};
function close(skill) { return new Promise((resolve, reject) => skill.close(error => error ? reject(error) : resolve())); }
const skill = new Skill(); skill.loadHome = function () { this.loaded = true; };
let homeGeneration;
Promise.resolve().then(() => {
    skill.open(); homeGeneration = skill.generation;
    assert(skill.active(homeGeneration)); assert.strictEqual(events.hjHeard.count(), 1);
    views.currentView = {}; assert(!skill.active(homeGeneration)); views.currentView = skill.view;
    skill.state.screen = 'voice'; let cancelled = false;
    skill.voiceRequest = { cancel: () => { cancelled = true; } };
    skill.holdFace(true);
    return Promise.all([close(skill), close(skill)]).then(() => {
        assert(cancelled); assert.strictEqual(jibo.face.paused, false); assert.strictEqual(skill.view, null);
        assert.strictEqual(events.hjHeard.count(), 0); assert.strictEqual(skill.tickTimer, null); assert(!skill.active(homeGeneration));
        skill.open(); assert(skill.active(skill.generation)); skill.view.swipe(); assert.strictEqual(skill.exits, 1); return close(skill);
    });
}).then(() => {
    console.log('PASS native view ownership, concurrent close, voice cancellation, face restore, reopen, swipe exit');
    return require('./navigation')(Skill).then(() => {
        console.log('PASS late page success/failure, repeated Home requests, search mode changes, and stale autoplay');
        return require('./upgrade')(load).then(() => require('./transport')(load)).then(() => require('./video')());
    });
}).then(() => {
    console.log('PASS Recipes-style media playback, synchronization, interruption, errors, and cleanup');
    // Use the actual bundled helper with this Node executable on a development machine.
    const service = load('service.js', { child_process: { spawn: (node, args, options) => child.spawn(process.execPath, args, options) } });
    const settings = service.settings(); assert(/^[a-f0-9]{48}$/.test(settings.token));
    assert.strictEqual(fs.statSync(path.join(process.env.JIBOTUBE_DATA_DIR, 'token')).mode & 511, 384);
    return service.ensure().then(ok => {
        assert(ok, 'helper must start under Node 6');
        return request('/health');
    }).then(res => { assert.strictEqual(res.status, 200); assert(res.data.ok); return request('/unknown'); })
      .then(res => { assert.strictEqual(res.status, 401); return request('/unknown', settings.token); })
      .then(res => { assert.strictEqual(res.status, 404); return service.stop(); })
      .then(() => service.ensure()).then(ok => { assert(ok); assert.strictEqual(service.settings().token, settings.token); return service.stop(); })
      .then(() => console.log('PASS real helper startup, authentication, shutdown, restart, persistent token'))
      .then(() => service.stop(), error => service.stop().then(() => { throw error; }));
}).then(() => { remove(temp); console.log('All JiboTube checks passed (' + process.version + ').'); }, error => { console.error(error.stack); process.exitCode = 1; });
