import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {bindService,checkPort,validPort} from '../../src/service-port.js';

test('port validation and bind fallback handle occupied ports',async()=>{
  assert.equal(validPort(1023),false);assert.equal(validPort(65536),false);assert.equal(validPort(8787),true);
  const first=net.createServer(),second=net.createServer();
  try {
    const port=await bindService(first,0,'127.0.0.1');
    assert.equal((await checkPort(port,'127.0.0.1',0)).available,false);
    await assert.rejects(bindService(second,port,'127.0.0.1'),error=>error.code==='EADDRINUSE');
    const fallback=await bindService(second,port,'127.0.0.1',true);assert.notEqual(fallback,port);
  }finally{first.close();second.close();}
});

test('authenticated port changes restart HTTP service, retain sessions and persist fallback policy',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'deck-service-'));let child,blocker=net.createServer();
  async function start(port) {
    const env={...process.env,HOST:'127.0.0.1',SSH_HOLD_WEB_DATA_DIR:temporary,SSH_HOLD_DIR:path.join(temporary,'hold')};
    delete env.PORT;if(port!==undefined)env.PORT=String(port);
    child=spawn(process.execPath,['src/server.js'],{cwd:path.resolve(import.meta.dirname,'../..'),env,stdio:['ignore','pipe','pipe']});
    return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Server start timed out: '+output)),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
  }
  async function stop(){if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}
  let port=await start(0),cookie='';
  const request=async(route,body)=>{
    const base=`http://127.0.0.1:${port}`;
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:{origin:base,'content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
    return {response,result:await response.json()};
  };
  try {
    assert.equal((await request('/api/settings/service')).response.status,401);
    const setup=await request('/api/auth/setup',{password:'test-password',confirmPassword:'test-password'});cookie=setup.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/settings/service/check',{port})).result.available,true);
    const occupied=await bindService(blocker,0,'127.0.0.1');
    const denied=await request('/api/settings/service',{port:occupied,autoSelect:false});assert.equal(denied.response.status,409);
    const saved=await request('/api/settings/service',{port:occupied,autoSelect:true});assert.equal(saved.response.status,200);assert.notEqual(saved.result.activePort,occupied);
    const oldPort=port;port=saved.result.activePort;
    assert.equal((await request('/api/settings/service')).result.autoSelect,true);
    // The response is flushed before the old listener is closed.
    await new Promise(resolve=>setTimeout(resolve,100));
    await assert.rejects(fetch(`http://127.0.0.1:${oldPort}/api/auth/status`));
    const same=await request('/api/settings/service',{port,autoSelect:true});assert.equal(same.response.status,200);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await request('/api/auth/status')).result.authenticated,true);
    await stop();port=await start();assert.equal((await request('/api/settings/service')).result.autoSelect,true);
  }finally{await stop();blocker.close();await rm(temporary,{recursive:true,force:true});}
});
