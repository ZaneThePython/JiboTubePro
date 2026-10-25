'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Stable across installed package revisions and BEam updates.
function dataRoot() {
    if (process.env.JIBOTUBE_DATA_DIR) return path.resolve(process.env.JIBOTUBE_DATA_DIR);
    return fs.existsSync('/opt/jibo/Jibo/Skills')
        ? '/opt/jibo/Knowledge/beacon/custom-skills/jibotube'
        : path.join(os.tmpdir(), 'beam-beacon', 'custom-skills', 'jibotube');
}
function ensureDirectory(dir) {
    try { fs.mkdirSync(dir, 448); }
    catch (error) {
        if (error.code === 'ENOENT') {
            ensureDirectory(path.dirname(dir));
            ensureDirectory(dir);
        } else if (error.code !== 'EEXIST' || !fs.statSync(dir).isDirectory()) throw error;
    }
    return dir;
}
module.exports = { dataRoot: dataRoot, ensureDirectory: ensureDirectory };
