import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

assert.equal(process.platform, 'darwin');
const bundle = path.resolve(process.argv[2] || 'src-tauri/target/release/bundle/macos/SSH Hold Deck.app');
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
// codesign writes its description to stderr, including on success.
const description = spawnSync('codesign', ['-dv', '--verbose=4', bundle], { encoding: 'utf8' });
assert.equal(description.status, 0, description.stderr);
assert.match(description.stderr, /^Identifier=com\.jacobs256\.sshholddeck$/m);
assert.match(description.stderr, /^Info\.plist entries=\d+$/m);
assert.match(description.stderr, /^Sealed Resources version=/m);
const usage = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSLocalNetworkUsageDescription', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' });
assert(usage.trim());
console.log('macOS bundle identity, signature, sealed resources and local network usage description verified.');
