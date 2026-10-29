(() => {
  const english = {
    '颜色模式': 'Appearance', '浅色模式': 'Light', '深色模式': 'Dark',
    'SSH Hold Deck 管理台': 'SSH Hold Deck Console', '通道管理': 'Channel Management',
    '通道列表': 'Channels', '▦　通道列表': 'Channels', 'SSH Hold Deck　/　通道列表': 'SSH Hold Deck / Channels',
    '管理本机 SSH Hold Deck 通道与连接状态': 'Manage SSH Hold Deck connections and status', '集成管理': 'Integrations',
    '搜索通道名、目标地址...': 'Search channels or destinations...', '全部状态': 'All Statuses',
    '全部认证': 'All Authentication', 'SSH 私钥': 'SSH Key', '用户名 / 密码': 'Password',
    '刷新': 'Refresh', '＋ 添加通道': '+ Add Channel', '全部通道': 'All Channels', '畅通': 'Connected',
    '已断开': 'Disconnected', '未知': 'Unknown', '连接失败': 'Connection Failed', '停了': 'Stopped',
    '通道名称': 'Channel Name', '目标地址': 'Destination', '跳板机': 'Gateway', '认证方式': 'Authentication',
    '状态': 'Status', '保活': 'Keepalive', '开通时间': 'Opened', '操作': 'Actions',
    '新增通道': 'Add Channel', '编辑通道': 'Edit Channel', '例如 prod-us-01': 'e.g. prod-us-01',
    '用户名': 'Username', '例如 root': 'e.g. root', '主机': 'Host', 'IP 地址或域名': 'IP address or hostname',
    '端口': 'Port', '密码': 'Password', '仅保存于本机加密凭据库': 'Stored encrypted on this computer',
    '私钥路径': 'Private Key Path', '跳过主机指纹校验（仅临时跳板使用）': 'Skip host key verification (temporary gateways only)',
    '取消': 'Cancel', '关闭': 'Close', '保存并连接': 'Save and Connect', '保存修改': 'Save Changes',
    '跳板通道': 'Gateway Channel', '不使用跳板（直接连接）': 'None (direct connection)', '不存在': 'Not Found',
    '确认操作': 'Confirm Action', '操作未完成': 'Action Failed', '确定': 'Confirm', '知道了': 'OK',
    '选择文件': 'Choose File', '私钥文件不能超过 64KB': 'Private key files must not exceed 64 KB',
    '从 ~/.ssh/hold 导入通道配置': 'Import channels from ~/.ssh/hold', '导入中…': 'Importing…',
    '通道名称已复制': 'Channel name copied', '复制失败，请检查浏览器剪贴板权限': 'Copy failed. Check clipboard permissions.',
    '请重新登录': 'Please sign in again', '请求失败': 'Request failed', '没有符合条件的通道': 'No matching channels',
    '直连': 'Direct', '本机通道': 'Local channel', '⚿ SSH 私钥': 'SSH Key', '● 用户名 / 密码': 'Password',
    '复制通道名称': 'Copy channel name', '打开终端': 'Open Terminal', '断开通道': 'Disconnect', '连接通道': 'Connect',
    '请先补全连接信息': 'Complete the connection settings first', '编辑': 'Edit', '删除': 'Delete',
    '正在读取通道列表...': 'Loading channels...', '重新加载': 'Retry', '正在连接…': 'Connecting…',
    '正在断开...': 'Disconnecting...', '正在连接...': 'Connecting...',
    '连接来源': 'Connection Source', '手动配置': 'Manual', 'JumpServer 资产': 'JumpServer Asset',
    '配置 JumpServer': 'Configure JumpServer', 'JumpServer 配置': 'JumpServer Settings', '资产搜索': 'Asset Search',
    '名称或 IP 地址': 'Name or IP address', '搜索资产': 'Search Assets', '服务器资产': 'Server Asset',
    '上一页': 'Previous Page', '下一页': 'Next Page', '登录账号': 'Account', '请选择 JumpServer': 'Select JumpServer',
    '请先选择资产': 'Select an asset first', '读取账号中…': 'Loading accounts…', '请选择账号': 'Select an account',
    '该资产没有可用的托管账号，或没有账号连接权限': 'No managed accounts with connection permission are available',
    '账号不可用': 'Account unavailable', '正在读取资产…': 'Loading assets…', '请先配置并选择 JumpServer': 'Configure and select JumpServer first',
    '没有匹配的资产': 'No matching assets', '资产读取失败': 'Could not load assets', '配置': 'Configuration',
    '新增 JumpServer': 'Add JumpServer', '名称': 'Name', 'HTTPS API 地址': 'HTTPS API URL', '组织': 'Organization',
    '请选择组织': 'Select an organization', '刷新组织列表': 'Refresh Organizations', 'SSH 网关': 'SSH Gateway',
    'SSH 端口': 'SSH Port', '删除配置': 'Delete Configuration', '测试连接': 'Test Connection', '保存': 'Save',
    '请先填写 API 地址和密钥': 'Enter the API URL and key first', '正在读取组织…': 'Loading organizations…',
    '当前用户没有可访问的组织': 'No organizations available for this user', '组织读取失败': 'Could not load organizations',
    '已保存；留空保留原密钥': 'Saved; leave blank to keep the current secret', '正在读取组织，请稍候': 'Loading organizations. Please wait.',
    '确定删除该 JumpServer 配置？': 'Delete this JumpServer configuration?',
    '正在验证认证和资产权限…': 'Checking authentication and asset access…', '正在保存…': 'Saving…',
    '配置已删除': 'Configuration deleted', '配置已保存': 'Configuration saved',
    '请选择有效的资产和登录账号': 'Select a valid asset and account',
    '密码登录': 'Sign In', '确认密码': 'Confirm Password', '登录': 'Sign In', '设置登录密码': 'Set Login Password',
    '设置并登录': 'Set Password and Sign In', '至少 8 个字符': 'At least 8 characters',
    '两次输入的密码不一致': 'Passwords do not match', '密码已设置，请登录': 'A password has been set. Please sign in.',
    '设置': 'Settings', '修改密码': 'Change Password', '退出登录': 'Sign Out', '修改登录密码': 'Change Login Password',
    '原密码': 'Current Password', '新密码': 'New Password', '确认新密码': 'Confirm New Password', '保存密码': 'Save Password',
    '无法读取登录状态，请刷新页面重试': 'Could not check sign-in status. Refresh to try again.',
    '新建当前通道终端': 'New Terminal for This Channel', '切换全屏': 'Toggle Fullscreen', '收起终端': 'Collapse Terminal',
    '终端': 'Terminal', '关闭终端': 'Close Terminal', '连接已关闭': 'Connection closed', '终端连接失败': 'Terminal connection failed',
    '已结束': 'Ended', '失败': 'Failed',
    '密码长度须为 8–256 个字符': 'Password must contain 8–256 characters', '密码错误次数过多，请稍后再试': 'Too many incorrect attempts. Try again later.',
    '登录密码已设置，请使用密码登录': 'A password is already set. Please sign in.', '请先设置登录密码': 'Set a login password first',
    '密码错误': 'Incorrect password', '原密码错误': 'Incorrect current password', '密码已修改，请重新登录': 'Password changed. Please sign in again.',
    '请先登录': 'Please sign in', '登录状态已失效，请重新登录': 'Session expired. Please sign in again.',
    '请先选择 JumpServer、资产和账号': 'Select JumpServer, an asset, and an account first',
    '请先编辑并填写用户名和主机': 'Enter a username and host first', '请先编辑并填写有效端口': 'Enter a valid port first',
    '请先编辑并保存密码': 'Save a password first', '请先编辑并选择私钥或填写私钥路径': 'Choose a private key or enter its path first',
    '请先编辑并设置认证方式': 'Choose an authentication method first', '请求来源无效': 'Invalid request origin',
    '通道不存在': 'Channel not found', '通道名称已存在，请使用其他名称': 'Channel name already exists. Choose another name.',
    '通道名称无效': 'Invalid channel name', '通道名无效': 'Invalid channel name', '分页参数无效': 'Invalid page offset',
    '该通道正在连接或更新，请稍后重试': 'This channel is being connected or updated. Try again shortly.',
    '该 JumpServer 仍被通道使用，请先修改或删除相关通道': 'This JumpServer is still used by channels. Reassign or remove them first.',
    'JumpServer 配置不存在，请先配置堡垒机': 'JumpServer configuration not found. Configure it first.', '配置已移除': 'Configuration removed',
    'JumpServer 请求失败，请检查网络、HTTPS 证书和服务地址': 'JumpServer request failed. Check the network, HTTPS certificate, and URL.',
    'JumpServer 认证失败，请检查密钥和本机时间': 'JumpServer authentication failed. Check the key and local clock.',
    'JumpServer 权限不足或要求额外认证': 'JumpServer requires additional permissions or authentication',
    'JumpServer 资产或 API 不存在': 'JumpServer asset or API not found',
    'JumpServer 拒绝了请求，请检查资产、账号或连接策略': 'JumpServer rejected the request. Check the asset, account, or connection policy.',
    '该资产需要登录审批，请先在 JumpServer 完成审批': 'This asset requires approval in JumpServer before connecting',
    'JumpServer 登录规则拒绝了连接': 'JumpServer login policy denied this connection',
    'JumpServer 资产授权已过期': 'JumpServer asset permission has expired', 'JumpServer 账号未授权或已不可用': 'JumpServer account is unauthorized or unavailable',
    'JumpServer 未返回可访问的组织列表': 'JumpServer did not return accessible organizations',
    '该资产未启用或没有 SSH 访问授权': 'This asset is disabled or SSH access is not permitted',
    '请选择有连接权限且已托管凭据的资产账号': 'Select a managed account with connection permission',
    '该连接需要 JumpServer 审批，请在堡垒机完成审批后重试': 'This connection requires JumpServer approval. Complete approval and try again.',
    'JumpServer 返回的连接令牌无效': 'JumpServer returned an invalid connection token',
    'SSH 连接超时，请检查网关地址、端口和访问策略': 'SSH connection timed out. Check the gateway, port, and access policy.',
    '请选择有效的 SSH 私钥文件（最大 64KB）': 'Choose a valid SSH private key (up to 64 KB)',
    '请填写密码或私钥路径后再保存连接': 'Enter a password or private key path before saving',
    '自动': 'Automatic', '语言': 'Language',
    '请填写 JumpServer 名称（最多 100 字）': 'Enter a JumpServer name (up to 100 characters)',
    'JumpServer API 地址无效': 'Invalid JumpServer API URL',
    'API 地址须为 HTTPS 服务地址，不含路径或登录信息': 'Use an HTTPS server URL without a path or embedded credentials',
    '请填写有效的 Key ID 和 Key Secret；更换地址或 Key ID 时须重新输入 Secret': 'Enter a valid Key ID and Key Secret. Re-enter the secret when changing the URL or Key ID.',
    '组织 ID 须为有效 UUID': 'Organization ID must be a valid UUID', 'SSH 网关地址或端口无效': 'Invalid SSH gateway address or port',
    'JumpServer 资产列表格式不兼容': 'Unsupported JumpServer asset list format', '资产 ID 无效': 'Invalid asset ID',
    '连接来源无效': 'Invalid connection source', '读取通道状态失败': 'Could not read channel status',
    '无法启动 ssh-hold，请检查本机安装': 'Could not start ssh-hold. Check its installation.',
    '请求过大': 'Request too large', 'JSON 无效': 'Invalid JSON', '断开失败': 'Could not disconnect', '删除失败': 'Could not delete',
    '关闭旧连接失败': 'Could not close the previous connection',
    '配置已保存，但连接失败，请检查认证信息后重试': 'Settings saved, but connection failed. Check the credentials and try again.',
    '跳板通道不能指向自身或形成循环': 'Gateway channels cannot reference themselves or form a loop',
    '终端请求来源无效': 'Invalid terminal request origin', '请先连接该通道': 'Connect this channel first',
    '登录状态已失效': 'Session expired', '终端启动失败': 'Could not start the terminal',
  };
  const patterns = [
    [/^显示 (\d+) 条结果$/, n => `${n} results`],
    [/^已导入 (\d+) 个通道(.*)$/, (n, tail) => `Imported ${n} channels${tail.replace(/，跳过 (\d+) 个无效配置/, ', skipped $1 invalid configurations')}`],
    [/^确定删除通道“(.*)”？这会关闭当前连接。$/, name => `Delete channel “${name}”? This will close its connection.`],
    [/^确定断开通道“(.*)”？配置和凭据将保留。$/, name => `Disconnect channel “${name}”? Its settings and credentials will be retained.`],
    [/^连接成功 · (.*) · (\d+) 个授权资产$/, (name, n) => `Connected · ${name} · ${n} authorized assets`],
    [/^在跑(.*)$/, rest => `Running${rest}`],
    [/^读取失败：(.*)$/, message => `Could not load: ${t(message)}`],
    [/^(.*)（当前配置）$/, value => `${value} (current configuration)`],
    [/^关闭 (.*) 终端$/, name => `Close ${name} terminal`],
    [/^终端已退出 \((.*)\)$/, code => `Terminal exited (${code})`],
    [/^(.*) · 已结束$/, value => `${value} · Ended`],
    [/^(.*) · 失败$/, value => `${value} · Failed`],
    [/^(.*) · 不存在$/, value => `${value} · Not Found`],
    [/^JumpServer 请求失败（HTTP (\d+)）$/, code => `JumpServer request failed (HTTP ${code})`],
    [/^JumpServer 未返回 JSON（HTTP (\d+)），请检查 API 地址$/, code => `JumpServer did not return JSON (HTTP ${code}). Check the API URL.`],
    [/^跳板通道 (.*) 不存在，请先 Reload 导入$/, name => `Gateway channel ${name} was not found. Import it with Reload first.`],
    [/^跳板通道 (.*) 未连接，请先连接跳板通道$/, name => `Gateway channel ${name} is disconnected. Connect it first.`],
  ];
  let preference = 'auto';
  try { preference = localStorage.getItem('ssh-hold-language') || 'auto'; } catch {}
  if (!['auto', 'zh-CN', 'en'].includes(preference)) preference = 'auto';
  const language = preference === 'auto' ? (/^zh\b/i.test(navigator.languages?.[0] || navigator.language) ? 'zh-CN' : 'en') : preference;
  function t(source) {
    if (source == null) return '';
    const text = String(source);
    if (language === 'zh-CN') return text;
    if (text.includes('\x1b')) return text.replace(/(\x1b\[[0-9;]*m)|([^\x1b]+)/g, (match, ansi, part) => ansi || t(part));
    const trimmed = text.trim();
    if (trimmed && trimmed !== text) return text.slice(0, text.indexOf(trimmed)) + t(trimmed) + text.slice(text.indexOf(trimmed) + trimmed.length);
    if (english[text]) return english[text];
    for (const [pattern, format] of patterns) { const match = text.match(pattern); if (match) return format(...match.slice(1)); }
    return text;
  }
  function translate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement?.closest('script,style,.name,.subtext,td[title]')) continue;
        const text = node.nodeValue.trim();
        if (node.parentElement?.matches('option:not([value])') && ['畅通', '已断开'].includes(text)) node.parentElement.value = text;
        if (text) node.nodeValue = node.nodeValue.replace(text, () => t(text));
      } else if (!node.matches('.name,.subtext,td[title]')) {
        for (const attr of ['title', 'placeholder', 'aria-label']) if (node.hasAttribute(attr)) node.setAttribute(attr, t(node.getAttribute(attr)));
      }
    }
  }
  function html(source) { const template = document.createElement('template'); template.innerHTML = source; translate(template.content); return template.innerHTML; }
  document.documentElement.lang = language;
  document.querySelector('header .crumb')?.remove();
  document.title = t('SSH Hold Deck 管理台');
  translate(document.body);
  const picker = document.createElement('div'); picker.className = 'language-control';
  picker.innerHTML = `<button class="language-toggle" type="button" aria-label="${t('语言')}" title="${t('语言')}" aria-haspopup="menu" aria-expanded="false" aria-controls="language-menu"><i data-lucide="languages"></i></button><div id="language-menu" class="language-menu" role="menu" aria-label="${t('语言')}" hidden>${[['auto', t('自动')], ['zh-CN', '简体中文'], ['en', 'English']].map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${value === preference}" data-language="${value}"><span>${label}</span><i data-lucide="check" ${value === preference ? '' : 'style="visibility:hidden"'}></i></button>`).join('')}</div>`;
  const toggle = picker.querySelector('.language-toggle');
  const menu = picker.querySelector('.language-menu');
  function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.onclick = () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); };
  toggle.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus(); } };
  menu.onclick = event => {
    const option = event.target.closest('[data-language]');
    if (!option) return;
    try { localStorage.setItem('ssh-hold-language', option.dataset.language); } catch {}
    location.reload();
  };
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); toggle.focus(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && menu.contains(document.activeElement)) {
      event.preventDefault();
      const options = [...menu.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    }
  });
  document.addEventListener('click', event => { if (!picker.contains(event.target)) closeMenu(); });
  picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget)) closeMenu(); });
  window.addEventListener('languagechange', () => { if (preference === 'auto') location.reload(); });
  window.I18n = { t, html, translate, language, preference, mountPicker: root => root.append(picker) };
  document.body.append(picker); lucide.createIcons();
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let themePreference = 'auto';
  try { themePreference = localStorage.getItem('ssh-hold-theme') || 'auto'; } catch {}
  if (!['auto', 'light', 'dark'].includes(themePreference)) themePreference = 'auto';
  const themePicker = document.createElement('div');
  themePicker.className = 'theme-control';
  themePicker.innerHTML = `<button type="button" class="language-toggle" title="${t('颜色模式')}" aria-label="${t('颜色模式')}" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu"><i data-lucide="sun-moon"></i></button><div id="theme-menu" class="language-menu" role="menu" aria-label="${t('颜色模式')}" hidden>${[['auto','monitor','自动'],['light','sun','浅色模式'],['dark','moon','深色模式']].map(([value,icon,label]) => `<button type="button" role="menuitemradio" data-theme="${value}" aria-checked="false"><i data-lucide="${icon}"></i><span>${t(label)}</span><i class="theme-check" data-lucide="check"></i></button>`).join('')}</div>`;
  picker.append(themePicker);
  const themeToggle = themePicker.querySelector('.language-toggle');
  const themeMenu = themePicker.querySelector('.language-menu');
  function applyTheme() {
    document.documentElement.dataset.theme = themePreference === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : themePreference;
    for (const option of themeMenu.querySelectorAll('button')) option.setAttribute('aria-checked', String(option.dataset.theme === themePreference));
  }
  function closeThemeMenu() { themeMenu.hidden = true; themeToggle.setAttribute('aria-expanded', 'false'); }
  themeToggle.onclick = event => { event.stopPropagation(); closeMenu(); themeMenu.hidden = !themeMenu.hidden; themeToggle.setAttribute('aria-expanded', String(!themeMenu.hidden)); };
  toggle.addEventListener('click', closeThemeMenu);
  themeMenu.onclick = event => {
    event.stopPropagation();
    const option = event.target.closest('[data-theme]');
    if (!option) return;
    themePreference = option.dataset.theme;
    try { localStorage.setItem('ssh-hold-theme', themePreference); } catch {}
    applyTheme(); closeThemeMenu(); themeToggle.focus();
  };
  themePicker.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); closeThemeMenu(); themeToggle.focus(); }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); themeMenu.hidden = false; themeToggle.setAttribute('aria-expanded','true');
      const options = [...themeMenu.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    }
  });
  document.addEventListener('click', event => { if (!themePicker.contains(event.target)) closeThemeMenu(); });
  themePicker.addEventListener('focusout', event => { if (!themePicker.contains(event.relatedTarget)) closeThemeMenu(); });
  systemTheme.addEventListener('change', () => { if (themePreference === 'auto') applyTheme(); });
  applyTheme(); lucide.createIcons();
})();
