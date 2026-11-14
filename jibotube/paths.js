'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Stable across installed package revisions and BEam updates.
// On the robot: JiboTube's own Knowledge section, which BEam lets a skill use without asking for Knowledge access.
const ROBOT_ROOT = '/opt/jibo/Knowledge/jibotube', OLD_ROBOT_ROOT = '/opt/jibo/Knowledge/beacon/custom-skills/jibotube';
let moved = false;
function dataRoot() {
    if (process.env.JIBOTUBE_DATA_DIR) return path.resolve(process.env.JIBOTUBE_DATA_DIR);
    if (!fs.existsSync('/opt/jibo/Jibo/Skills')) return path.join(os.tmpdir(), 'beam-beacon', 'custom-skills', 'jibotube');
    // Versions before 1.2.0 kept settings, history and the cache in BEacon's folder: move them once. `mv` runs under
    // the run-programs permission JiboTube already needs for its helper (BEam would refuse a direct rename there).
    if (!moved) {
        moved = true;
        if (fs.existsSync(OLD_ROBOT_ROOT) && !fs.existsSync(ROBOT_ROOT)) {
            try { require('child_process').execFileSync('/bin/mv', [OLD_ROBOT_ROOT, ROBOT_ROOT]); } catch (error) { /* start fresh */ }
        }
    }
    return ROBOT_ROOT;
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
