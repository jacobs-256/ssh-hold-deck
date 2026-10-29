import path from 'node:path';
import { execFile } from 'node:child_process';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function jumpOptions(config, configs, holdDir, check = socket => new Promise(resolve => {
  execFile('ssh', ['-O', 'check', '-o', `ControlPath=${socket}`, 'dummy'], {timeout:5000}, error => resolve(!error));
})) {
  if (!config.jump) return [];
  let name = config.jump;
  const visited = new Set([config.name]);
  while (name) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || visited.has(name)) throw new Error('跳板通道不能指向自身或形成循环');
    visited.add(name);
    if (!configs[name]) throw new Error(`跳板通道 ${name} 不存在，请先 Reload 导入`);
    name = configs[name].jump;
  }
  const socket = path.join(holdDir, config.jump, 'sock');
  if (!await check(socket)) throw new Error(`跳板通道 ${config.jump} 未连接，请先连接跳板通道`);
  return ['-o', `ProxyCommand=ssh -o ${quote(`ControlPath=${socket}`)} -o ControlMaster=no -o BatchMode=yes -W %h:%p dummy`];
}
