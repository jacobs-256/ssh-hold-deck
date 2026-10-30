import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp=await mkdtemp(path.join(os.tmpdir(),'hold-sqlite-'));
const hold=path.join(temp,'hold');
await mkdir(path.join(hold,'sample'),{recursive:true});
await mkdir(path.join(temp,'bin'));
await writeFile(path.join(hold,'sample/meta'),'TARGET=root@example.com\nPORT=2222\nAUTH=key\nINSECURE=0\nSTARTED=2026-10-29\\ 09:00:00\n');
await writeFile(path.join(temp,'bin/ssh-hold'),'#!/bin/sh\necho "现在没有撑开的通道。"\n',{mode:0o700});
let child;
let cookie='';
const fetch=async(url,options={})=>{const response=await globalThis.fetch(url,{...options,headers:{...options.headers,cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
async function start(){child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOME:temp,SSH_HOLD_DIR:hold,SSH_HOLD_WEB_DATA_DIR:path.join(temp,'data'),PORT:'18787',PATH:`${temp}/bin:${process.env.PATH}`},stdio:['ignore','pipe','inherit']});await once(child.stdout,'data');const state=await(await fetch('http://127.0.0.1:18787/api/auth/status')).json();if(!state.configured)await fetch('http://127.0.0.1:18787/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'sqlite-test-password',confirmPassword:'sqlite-test-password'})});}
async function stop(){child.kill();await once(child,'exit');child=null;}
const get=async()=>await (await fetch('http://127.0.0.1:18787/api/channels')).json();
try{
 await start();await fetch('http://127.0.0.1:18787/api/channels/refresh',{method:'POST'});let result=await get();assert.equal(result.channels.length,1);assert.equal(result.channels[0].target,'root@example.com:2222');assert.equal(result.channels[0].status,'已断开');
 assert.equal((await globalThis.fetch('http://127.0.0.1:18787/api/channels/events')).status,401);
 assert.equal((await(await fetch('http://127.0.0.1:18787/api/settings/refresh')).json()).seconds,30);
 for(const seconds of [0,4,3601,5.5,'10'])assert.equal((await fetch('http://127.0.0.1:18787/api/settings/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seconds})})).status,400);
 await fetch('http://127.0.0.1:18787/api/settings/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seconds:5})});
 const stream=await fetch('http://127.0.0.1:18787/api/channels/events',{signal:AbortSignal.timeout(12000)});
 assert.match(stream.headers.get('content-type'),/text\/event-stream/);
 const reader=stream.body.getReader();const decoder=new TextDecoder();let pending='';
 async function nextEvent(){while(!pending.includes('\n\n')){const chunk=await reader.read();assert.ok(!chunk.done);pending+=decoder.decode(chunk.value,{stream:true});}const end=pending.indexOf('\n\n');const event=pending.slice(0,end);pending=pending.slice(end+2);return JSON.parse(event.split('\n').find(line=>line.startsWith('data: ')).slice(6));}
 assert.equal((await nextEvent())[0].status,'已断开');
 await writeFile(path.join(temp,'bin/ssh-hold'),'#!/bin/sh\nprintf "  sample\\n    通道: 畅通\\n    保活: 在跑\\n"\n',{mode:0o700});
 assert.equal((await nextEvent())[0].status,'畅通','定时检查必须推送变化');
 await reader.cancel();
 await writeFile(path.join(temp,'bin/ssh-hold'),'#!/bin/sh\nsleep 2\necho "现在没有撑开的通道。"\n',{mode:0o700});
 const before=performance.now();await get();assert.ok(performance.now()-before<1000,'列表不应等待 SSH 命令');
 const db=new DatabaseSync(path.join(temp,'data/channels.sqlite'));assert.equal(db.prepare('SELECT count(*) AS n FROM channels').get().n,1);assert.ok(!db.prepare('SELECT config FROM channels').get().config.includes('example.com'));db.close();
 await writeFile(path.join(hold,'sample/meta'),'TARGET=alice@updated.example\nPORT=2200\nAUTH=password\nINSECURE=1\n');
 result=await(await fetch('http://127.0.0.1:18787/api/channels/reload',{method:'POST'})).json();assert.equal(result.imported,1);assert.equal(result.channels[0].target,'alice@updated.example:2200');
 await fetch('http://127.0.0.1:18787/api/channels/reload',{method:'POST'});assert.equal((await get()).channels.length,1);
 await stop();await rm(hold,{recursive:true});await start();assert.equal((await get()).channels[0].target,'alice@updated.example:2200');
 assert.equal((await(await fetch('http://127.0.0.1:18787/api/settings/refresh')).json()).seconds,5,'刷新间隔重启后保留');
 const disconnected=await(await fetch('http://127.0.0.1:18787/api/channels/sample?action=disconnect',{method:'POST'})).json();
 assert.equal(disconnected.channel.status,'已断开');assert.equal((await get()).channels.length,1);
 console.log('PASS: SQLite导入、去重、重启保留、断开后配置保留');
}finally{if(child)await stop();await rm(temp,{recursive:true,force:true});}
