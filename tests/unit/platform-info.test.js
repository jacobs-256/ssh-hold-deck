import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlatform } from '../compat/platform-info.js';

test('platform markers ignore banners and prefer distribution names', () => {
  assert.deepEqual(parsePlatform('Welcome\nSSH_HOLD_OS=Linux\nSSH_HOLD_ARCH=x86_64\nSSH_HOLD_DISTRO="Ubuntu 24.04 LTS"\n'), { operatingSystem: 'Ubuntu 24.04 LTS', architecture: 'x86_64' });
  assert.deepEqual(parsePlatform('SSH_HOLD_OS=Darwin\r\nSSH_HOLD_ARCH=arm64\r\n'), { operatingSystem: 'Darwin', architecture: 'arm64' });
  assert.deepEqual(parsePlatform('Access denied'), { operatingSystem: '', architecture: '' });
});
