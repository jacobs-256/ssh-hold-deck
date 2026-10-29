export function connectionAvailability(config) {
  if (config.source === 'jumpserver') {
    const reason = config.serverId && config.assetId && config.account ? '' : '请先选择 JumpServer、资产和账号';
    return { canConnect: !reason, connectDisabledReason: reason };
  }
  let reason = '';
  if (!/^[^\s@]+@[^\s@]+$/.test(config.target || '')) reason = '请先编辑并填写用户名和主机';
  else if (!Number.isInteger(Number(config.port || 22)) || Number(config.port || 22) < 1 || Number(config.port || 22) > 65535) reason = '请先编辑并填写有效端口';
  else if (config.auth === 'password' && !config.password) reason = '请先编辑并保存密码';
  else if (config.auth === 'key' && !config.identity?.trim()) reason = '请先编辑并选择私钥或填写私钥路径';
  else if (!['password', 'key'].includes(config.auth)) reason = '请先编辑并设置认证方式';
  return { canConnect: !reason, connectDisabledReason: reason };
}
