import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute=promisify(execFile);
export function validPort(port) {return Number.isInteger(port)&&port>=1024&&port<=65535;}
export async function portOwners(port) {
  try {
    const {stdout}=await execute('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fpc'],{timeout:3000,maxBuffer:65536});
    const owners=[];let owner;
    for(const line of stdout.split('\n')) {
      if(line.startsWith('p')) {owner={pid:Number(line.slice(1)),command:''};if(owner.pid!==process.pid)owners.push(owner);}
      if(line.startsWith('c')&&owner)owner.command=line.slice(1);
    }
    return {owners,detailsAvailable:true};
  } catch(error) {return {owners:[],detailsAvailable:error.code===1};}
}
export function listen(server,port,host) {
  return new Promise((resolve,reject)=>{
    const failed=error=>{server.off('listening',ready);reject(error);};
    const ready=()=>{server.off('error',failed);resolve(server.address().port);};
    server.once('error',failed);server.once('listening',ready);server.listen(port,host);
  });
}
export async function bindService(server,port,host,autoSelect=false) {
  if(!validPort(port)&&port!==0)throw Error('服务端口必须为 1024–65535 的整数');
  try {return await listen(server,port,host);}
  catch(error){if(!autoSelect||error.code!=='EADDRINUSE')throw error;return listen(server,0,host);}
}
export async function checkPort(port,host,currentPort) {
  if(!validPort(port))throw Error('服务端口必须为 1024–65535 的整数');
  const details=await portOwners(port);
  if(port===currentPort&&!details.owners.length)return {port,available:true,current:true,...details};
  const probe=net.createServer();
  try {await listen(probe,port,host);await new Promise(resolve=>probe.close(resolve));return {port,available:true,current:false,...details};}
  catch(error){if(error.code!=='EADDRINUSE')throw error;return {port,available:false,current:false,...details};}
}
