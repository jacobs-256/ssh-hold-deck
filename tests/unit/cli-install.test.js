import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('CLI detection, failed download, concurrent installation and PATH work without changing the real home', async () => {
  const home = await mkdtemp(path.join(tmpdir(),'deck-cli-test-'));
  try {
    const source = `
      import assert from 'node:assert/strict';
      import {cliStatus,installCli} from ${JSON.stringify(new URL('../../src/cli-install.js',import.meta.url).href)};
      process.env.PATH=process.env.HOME+'/.local/bin';
      assert.equal((await cliStatus()).installed,false);
      globalThis.fetch=async()=>new Response('error',{status:503});
      await assert.rejects(installCli(),/503/);
      assert.equal((await cliStatus()).installed,false);
      let downloads=0;
      globalThis.fetch=async()=>{downloads++;return new Response('#!/bin/bash\\necho test-version\\n');};
      await Promise.all([installCli(),installCli()]);
      assert.equal(downloads,1);
      const status=await cliStatus();
      assert.equal(status.installed,true);assert.equal(status.version,'test-version');
      await installCli();assert.equal(downloads,1);
    `;
    await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{env:{...process.env,HOME:home},timeout:15000});
  } finally {await rm(home,{recursive:true,force:true});}
});
