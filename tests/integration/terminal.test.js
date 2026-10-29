import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {attachTerminals} from '../../src/terminal-server.js';

test('terminal sessions are independent, resize, reject reused grants and clean up',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'hold-terminal-'));const previous=process.env.PATH;
 await writeFile(path.join(temp,'ssh-hold'),'#!/bin/sh\nexec /bin/sh\n',{mode:0o700});process.env.PATH=`${temp}:${previous}`;
 let valid=true;const server=http.createServer();const terminals=attachTerminals(server,{channels:async()=>[{name:'test'}],run:async()=>({ok:true,stdout:'通道: 畅通'}),holdDir:temp,session:req=>valid&&req.headers.cookie==='session=valid'?'valid':null});server.listen(0,'127.0.0.1');await once(server,'listening');const host=`127.0.0.1:${server.address().port}`;const req={headers:{host,origin:`http://${host}`,cookie:'session=valid'}};const clients=[];
 try{
  await assert.rejects(terminals.issue({headers:{host,origin:'http://evil.example',cookie:'session=valid'}},'test'),/来源/);
  await assert.rejects(terminals.issue({headers:{host,origin:`http://${host}`}},'test'),/登录/);
  await assert.rejects(terminals.issue(req,'missing'),/不存在/);
  for(let i=0;i<2;i++){
   const token=await terminals.issue(req,'test');const ws=new WebSocket(`ws://${host}/terminal?token=${token}`,{origin:`http://${host}`,headers:{Cookie:'session=valid'}});clients.push(ws);let output='';ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='output')output+=msg.data;});await once(ws,'open');
   ws.send(JSON.stringify({type:'resize',cols:123,rows:31}));ws.send(JSON.stringify({type:'input',data:`printf '\\124\\105\\122\\115${i}'; stty size\r`}));
   const deadline=Date.now()+5000;while(!output.includes(`TERM${i}`)||!output.includes('31 123')){assert.ok(Date.now()<deadline,output);await new Promise(r=>setTimeout(r,20));}
   const denied=new WebSocket(`ws://${host}/terminal?token=${token}`,{origin:`http://${host}`});await new Promise(resolve=>denied.once('error',resolve));
  }
  clients[0].close();await once(clients[0],'close');assert.equal(clients[1].readyState,1);
  const noCookieToken=await terminals.issue(req,'test');const noCookie=new WebSocket(`ws://${host}/terminal?token=${noCookieToken}`,{origin:`http://${host}`});await new Promise(resolve=>noCookie.once('error',resolve));
  const revokedToken=await terminals.issue(req,'test');valid=false;const closed=once(clients[1],'close');terminals.revokeInvalid();await closed;
  const expired=new WebSocket(`ws://${host}/terminal?token=${revokedToken}`,{origin:`http://${host}`,headers:{Cookie:'session=valid'}});await new Promise(resolve=>expired.once('error',resolve));
 }finally{for(const ws of clients)ws.close();await new Promise(r=>server.close(r));process.env.PATH=previous;await rm(temp,{recursive:true,force:true});}
});
