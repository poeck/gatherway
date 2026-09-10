const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'config.json');
    this.config = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {
      version: 1, key: crypto.randomBytes(32).toString('base64'), beacon: crypto.randomUUID(),
      host: '', port: 47831, spaceId: '', selfId: '', paused: false, locations: {},
      presence: { calibrated: false, dwellMs: 5000 }, movementVerified: false,
      adapterVerified: false, profile: null, firebasePath: '',
    };
    this.save();
  }
  save() {
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  log(code) {
    // Only fixed diagnostic codes belong here, never exception bodies or page content.
    const file = path.join(this.directory, 'diagnostics.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 128 * 1024) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), code }) + '\n', { mode: 0o600 });
  }
}
module.exports = { Store };
