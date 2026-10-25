'use strict';
const assert = require('assert'), EventEmitter = require('events');
module.exports = function (load) {
    const requests = [], pendingTimers = [];
    const clientModule = load('client.js', {
        http: { request: (options, respond) => {
            const request = new EventEmitter(); request.respond = respond; request.end = () => {}; request.write = () => {};
            request.abort = () => { request.aborted = true; }; requests.push(request); return request;
        } },
        timers: { setTimeout: fn => { const timer = { fire: fn, cleared: false }; pendingTimers.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; } }
    });
    const client = new clientModule.Client({ base: 'http://localhost', token: 'test' });
    function response(request, code, body) {
        const result = new EventEmitter(); result.statusCode = code; result.destroy = () => { result.destroyed = true; };
        request.respond(result); result.emit('data', Buffer.from(body)); return result;
    }
    const slow = client.request('GET', '/slow');
    const res = response(requests[0], 200, '{');
    // Body trickling does not renew the overall deadline.
    pendingTimers[0].fire();
    return slow.then(() => { throw Error('deadline must reject'); }, error => {
        assert.strictEqual(error.code, 'timeout'); assert(requests[0].aborted && res.destroyed);
        assert.strictEqual(client.requests.length, 0);
        const failed = client.request('GET', '/failed');
        response(requests[1], 502, JSON.stringify({ error: 'timeout', retryable: false })).emit('end');
        return failed.then(() => { throw Error('failure must reject'); }, failure => {
            assert.strictEqual(failure.code, 'timeout'); assert.strictEqual(clientModule.status(failure).retryable, false);
        });
    }).then(() => {
        const aborted = client.request('GET', '/aborted');
        response(requests[2], 200, '{').emit('aborted');
        return aborted.then(() => { throw Error('aborted response must reject'); }, error => assert.strictEqual(error.code, 'network_unavailable'));
    }).then(() => {
        const sidx = Buffer.alloc(44); sidx.writeUInt32BE(44, 0); sidx.write('sidx', 4);
        sidx.writeUInt32BE(1000, 16); sidx.writeUInt16BE(1, 30); sidx.writeUInt32BE(1024, 32); sidx.writeUInt32BE(10000, 36);
        const format = (url, height, mime) => ({ url: url, height: height, mimeType: mime, itag: height,
            initRange: { start: '0', end: '0' }, indexRange: { start: '1', end: '44' } });
        const good = format('http://good', 480, 'video/mp4; codecs="avc1.4d401e"');
        const audio = format('http://audio', 140, 'audio/mp4; codecs="mp4a.40.2"');
        const util = require('../helper/lib/util');
        const stream = load('helper/lib/stream.js', {
            './yt': { video: () => Promise.resolve({ title: 'Test', duration: 60, formats: { videoCandidates: [format('http://bad', 480, 'video/mp4'), good], audio: audio } }) },
            './sponsorblock': { segments: () => Promise.resolve([]) },
            './util': Object.assign({}, util, { requestBuffer: (url, options) => {
                if (url === 'http://bad') return Promise.reject(util.failure('range_mismatch'));
                const range = options.headers.Range.slice(6);
                return Promise.resolve({ status: 206, headers: { 'content-range': 'bytes ' + range + '/2048' }, buffer: range === '0-0' ? Buffer.alloc(1) : sidx });
            } })
        });
        return stream.info('abcdefghijk', 0).then(info => {
            assert.strictEqual(info.videoMime, good.mimeType); assert.strictEqual(info.audioMime, audio.mimeType);
            assert.strictEqual(info.height, 480); assert.strictEqual(info.status, 'format_fallback');
            assert(info.video.indexOf('/stream/abcdefghijk/video') === 0);
        });
    }).then(() => { client.close(); assert(pendingTimers.every(timer => timer.cleared)); console.log('PASS total client deadline, retryability, aborted bodies, indexed-format fallback and buffered-player codec contract'); });
};
