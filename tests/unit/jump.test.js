import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jumpOptions } from '../../src/jump.js';

test('direct connection and existing jump socket', async () => {
  assert.deepEqual(await jumpOptions({name:'target'}, {}, '/tmp/hold'), []);
  const options = await jumpOptions({name:'target',jump:'ip100'}, {ip100:{}}, '/tmp/hold', async socket => socket === '/tmp/hold/ip100/sock');
  assert.equal(options[0], '-o');
  assert.match(options[1], /ControlPath=\/tmp\/hold\/ip100\/sock/);
  assert.match(options[1], /-W %h:%p dummy$/);
});
test('reject unavailable, missing, self and cyclic jumps', async () => {
  await assert.rejects(jumpOptions({name:'a',jump:'b'}, {b:{}}, '/tmp', async()=>false), /未连接/);
  await assert.rejects(jumpOptions({name:'a',jump:'b'}, {}, '/tmp'), /不存在/);
  await assert.rejects(jumpOptions({name:'a',jump:'a'}, {a:{}}, '/tmp'), /循环/);
  await assert.rejects(jumpOptions({name:'a',jump:'b'}, {b:{jump:'a'},a:{}}, '/tmp'), /循环/);
});
