const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const files = ['main.js', ...fs.readdirSync('desktop').filter(name => name.endsWith('.js')).map(name => path.join('desktop', name))];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Syntax checked ${files.length} desktop files.`);
