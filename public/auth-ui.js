(() => {
  document.body.classList.add('ui-aligned');
  const normalizeIcons = root => {
    for (const button of root.querySelectorAll('.close,.message-close')) {
      if (button.querySelector('svg,i')) continue;
      button.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      button.setAttribute('aria-label', I18n.t('关闭'));
    }
    for (const marker of root.querySelectorAll('.message-icon')) {
      if (marker.querySelector('svg,i')) continue;
      marker.innerHTML = '<i data-lucide="circle-alert" aria-hidden="true"></i>';
    }
    lucide.createIcons();
  };
  let iconUpdate = false;
  new MutationObserver(records => {
    if (iconUpdate || !records.some(record => record.target.matches?.('.message-icon') && !record.target.querySelector('svg,i') || [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('dialog,.close,.message-close') || node.querySelector?.('.close,.message-close'))))) return;
    iconUpdate = true; normalizeIcons(document); iconUpdate = false;
  }).observe(document.body, {childList:true,subtree:true});
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/assets/desktop.css';
  document.head.append(stylesheet);
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  document.querySelector('.logo>span').innerHTML = '<img class="brand-icon brand-icon-light" src="/assets/ssh-hold-deck-light.svg" width="32" height="32" alt=""><img class="brand-icon brand-icon-dark" src="/assets/ssh-hold-deck-dark.svg" width="32" height="32" alt="">';
  const channelMenu = document.querySelector('.sidebar nav');
  channelMenu.setAttribute('aria-label', I18n.t('通道管理'));
  channelMenu.innerHTML = [
    ['', 'layers', '通道列表', 'total'],
    ['畅通', 'circle-check', '畅通', 'up'],
    ['已断开', 'unplug', '已断开', 'down'],
  ].map(([status, symbol, label, count]) => `<button type="button" data-status="${status}" class="${status ? '' : 'active'}" aria-pressed="${!status}" title="${I18n.t(label)}">${icon(symbol)}<span>${I18n.t(label)}</span><span class="nav-count" data-count="${count}">0</span></button>`).join('');
  const syncNavigation = () => {
    for (const button of channelMenu.querySelectorAll('button')) {
      const active = !document.querySelector('.preferences-page:not([hidden]),.dashboard-page:not([hidden])') && button.dataset.status === document.querySelector('#status').value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.querySelector('.nav-count').textContent = document.getElementById(button.querySelector('.nav-count').dataset.count).textContent;
    }
  };
  channelMenu.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const status = document.querySelector('#status'); status.value = button.dataset.status;
    status.dispatchEvent(new Event('change')); syncNavigation();
  });
  document.querySelector('#status').addEventListener('change', syncNavigation);
  new MutationObserver(syncNavigation).observe(document.querySelector('.summary'), { subtree:true, childList:true, characterData:true });
  document.querySelector('.search>span').innerHTML = icon('search');
  document.querySelector('#search').setAttribute('aria-label', I18n.t('搜索通道名、目标地址...'));
  for (const id of ['status', 'auth-filter']) {
    const field = document.getElementById(id); field.setAttribute('aria-label', field.options[0].textContent);
  }
  document.querySelector('#refresh').innerHTML = icon('refresh-cw');
  document.querySelector('#refresh').setAttribute('aria-label', I18n.t('刷新'));
  document.querySelector('#add').innerHTML = `${icon('plus')}<span>${I18n.t('添加通道')}</span>`;
  document.querySelector('#modal .close').innerHTML = icon('x');
  document.querySelector('#modal .close').setAttribute('aria-label', I18n.t('关闭'));
  lucide.createIcons();
  const login = document.createElement('dialog');
  login.id = 'login-dialog';
  login.innerHTML = I18n.html(`<form id="login-form"><div class="modal-head"><div><p class="login-brand">SSH Hold Deck</p><h2>密码登录</h2></div><i data-lucide="lock-keyhole"></i></div><label>密码<input name="password" type="password" required maxlength="256" autocomplete="current-password"></label><label id="login-confirm" hidden>确认密码<input name="confirmPassword" type="password" maxlength="256" autocomplete="new-password"></label><p class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">登录</button></div></form>`);
  document.body.append(login);
  const loginForm = login.querySelector('form');
  const retryLogin = document.createElement('button');
  retryLogin.type = 'button'; retryLogin.className = 'secondary'; retryLogin.hidden = true;
  retryLogin.textContent = I18n.t('重新加载');
  login.querySelector('.actions').prepend(retryLogin);
  retryLogin.onclick = () => { retryLogin.disabled = true; location.reload(); };
  let setup = false, submitting = false;
  const call = async (url, body) => {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(I18n.t(result.error || '请求失败'));
    return result;
  };
  function showLogin(configured) {
    setup = !configured;
    login.querySelector('h2').textContent = setup ? I18n.t('设置登录密码') : I18n.t('密码登录');
    login.querySelector('button[type=submit]').textContent = setup ? I18n.t('设置并登录') : I18n.t('登录');
    login.querySelector('#login-confirm').hidden = !setup;
    loginForm.elements.confirmPassword.required = setup;
    loginForm.elements.password.minLength = setup ? 8 : 1;
    loginForm.elements.password.autocomplete = setup ? 'new-password' : 'current-password';
    loginForm.elements.password.placeholder = setup ? I18n.t('至少 8 个字符') : '';
    I18n.mountPicker(login);
    if (!login.open) login.showModal();
    lucide.createIcons(); loginForm.elements.password.focus();
  }
  login.addEventListener('cancel', event => event.preventDefault());
  loginForm.onsubmit = async event => {
    event.preventDefault(); if (submitting) return;
    const body = Object.fromEntries(new FormData(loginForm));
    const error = login.querySelector('.error'); error.textContent = '';
    if (setup && body.password !== body.confirmPassword) { error.textContent = I18n.t('两次输入的密码不一致'); return; }
    submitting = true; loginForm.querySelector('[type=submit]').disabled = true;
    try { await call(setup ? '/api/auth/setup' : '/api/auth/login', body); location.reload(); }
    catch (e) {
      error.textContent = e.message;
      try { const state = await call('/api/auth/status'); if (state.configured && setup) { showLogin(true); error.textContent = I18n.t('密码已设置，请登录'); } } catch {}
    } finally { submitting = false; loginForm.querySelector('[type=submit]').disabled = false; }
  };

  function settings() {
    const area = document.createElement('div'); area.className = 'account-settings';
    area.innerHTML = I18n.html(`<button type="button" class="settings-toggle" title="设置" aria-label="设置" aria-haspopup="menu" aria-expanded="false"><i data-lucide="settings"></i><span>设置</span></button><div class="account-menu" role="menu" hidden><button type="button" role="menuitem" data-action="password"><i data-lucide="key-round"></i>修改密码</button><button type="button" role="menuitem" data-action="logout"><i data-lucide="log-out"></i>退出登录</button></div>`);
    document.querySelector('.sidebar').append(area);
    const toggle = area.querySelector('.settings-toggle'), menu = area.querySelector('.account-menu');
    const refreshButton = document.createElement('button');
    refreshButton.type = 'button'; refreshButton.setAttribute('role', 'menuitem');
    refreshButton.innerHTML = I18n.html('<i data-lucide="timer"></i>刷新设置'); menu.prepend(refreshButton);
    const refreshDialog = document.createElement('dialog'); refreshDialog.id = 'refresh-dialog';
    refreshDialog.innerHTML = I18n.html('<form><div class="modal-head"><h2>刷新设置</h2><button type="button" class="close" aria-label="关闭">×</button></div><label>刷新间隔（秒）<input name="seconds" type="number" min="5" max="3600" step="1" required value="30"></label><p class="error" role="alert"></p><div class="actions"><button type="button" class="secondary">取消</button><button type="submit" class="primary">保存</button></div></form>');
    document.body.append(refreshDialog);
    const refreshForm = refreshDialog.querySelector('form'); let refreshSaving = false;
    refreshButton.onclick = async () => {
      closeMenu(); refreshDialog.querySelector('.error').textContent = ''; refreshForm.elements.seconds.disabled = true;
      refreshForm.querySelector('[type=submit]').disabled = true; refreshDialog.showModal();
      try { const result = await call('/api/settings/refresh'); refreshForm.elements.seconds.value = result.seconds; }
      catch (error) { refreshDialog.querySelector('.error').textContent = error.message; }
      finally { refreshForm.elements.seconds.disabled = false; refreshForm.querySelector('[type=submit]').disabled = false; }
    };
    refreshDialog.querySelectorAll('.close,.secondary').forEach(button => button.onclick = () => { if (!refreshSaving) refreshDialog.close(); });
    refreshDialog.addEventListener('cancel', event => { if (refreshSaving) event.preventDefault(); });
    refreshForm.onsubmit = async event => {
      event.preventDefault(); if (refreshSaving) return;
      refreshSaving = true; const submit = refreshForm.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = I18n.t('保存中…');
      refreshDialog.querySelector('.error').textContent = '';
      try { await call('/api/settings/refresh', { seconds: Number(refreshForm.elements.seconds.value) }); refreshDialog.close(); }
      catch (error) { refreshDialog.querySelector('.error').textContent = error.message; }
      finally { refreshSaving = false; submit.disabled = false; submit.textContent = I18n.t('保存'); }
    };
    const closeMenu = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.onclick = () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button').focus(); };
    document.addEventListener('click', event => { if (!area.contains(event.target)) closeMenu(); });
    area.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeMenu(); toggle.focus(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && !menu.hidden) {
        event.preventDefault(); const items = [...menu.querySelectorAll('button')];
        items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    const change = document.createElement('dialog'); change.id = 'password-dialog';
    change.innerHTML = I18n.html(`<form><div class="modal-head"><h2>修改登录密码</h2><button type="button" class="close" aria-label="关闭">×</button></div><label>原密码<input name="currentPassword" type="password" required maxlength="256" autocomplete="current-password"></label><label>新密码<input name="password" type="password" required minlength="8" maxlength="256" placeholder="至少 8 个字符" autocomplete="new-password"></label><label>确认新密码<input name="confirmPassword" type="password" required maxlength="256" autocomplete="new-password"></label><p class="error" role="alert"></p><div class="actions"><button class="secondary" type="button" data-action="cancel">取消</button><button class="primary" type="submit">保存密码</button></div></form>`);
    document.body.append(change);
    let changing = false;
    const changeForm = change.querySelector('form');
    area.querySelector('[data-action=password]').onclick = () => { closeMenu(); changeForm.reset(); change.querySelector('.error').textContent = ''; change.showModal(); changeForm.elements.currentPassword.focus(); };
    for (const button of change.querySelectorAll('.close,[data-action=cancel]')) button.onclick = () => { if (!changing) change.close(); };
    change.addEventListener('cancel', event => { if (changing) event.preventDefault(); });
    change.addEventListener('close', () => changeForm.reset());
    changeForm.onsubmit = async event => {
      event.preventDefault(); if (changing) return;
      const body = Object.fromEntries(new FormData(changeForm));
      const error = change.querySelector('.error'); error.textContent = '';
      if (body.password !== body.confirmPassword) { error.textContent = I18n.t('两次输入的密码不一致'); return; }
      changing = true; changeForm.querySelector('button[type=submit]').disabled = true;
      try { await call('/api/auth/password', body); location.reload(); }
      catch (e) { error.textContent = e.message; }
      finally { changing = false; changeForm.querySelector('button[type=submit]').disabled = false; }
    };
    area.querySelector('[data-action=logout]').onclick = async () => {
      closeMenu();
      try { await call('/api/auth/logout', {}); location.reload(); } catch (e) { await window.showMessage(e.message); }
    };
    const preferences = document.createElement('section'); preferences.className = 'preferences-page'; preferences.hidden = true;
    preferences.innerHTML = I18n.html(`<div class="preferences-heading"><h1><i data-lucide="settings"></i>设置</h1></div><section class="preferences-section"><h2>外观</h2><div class="preference-row"><h3>主题</h3><div class="theme-options"></div></div><div class="preference-row"><h3>语言</h3><div class="locale-options"></div></div></section><section class="preferences-section"><h2>通道管理</h2><div class="preference-row"><h3>刷新设置</h3><button type="button" class="secondary" data-setting="refresh"><i data-lucide="timer"></i>刷新设置</button></div></section><section class="preferences-section"><h2>账户</h2><div class="preference-row"><h3>修改密码</h3><button type="button" class="secondary" data-setting="password"><i data-lucide="key-round"></i>修改密码</button></div><div class="preference-row"><h3>退出登录</h3><button type="button" class="secondary danger" data-setting="logout"><i data-lucide="log-out"></i>退出登录</button></div></section><div class="preferences-version">SSH Hold Deck <span>v0.1.0</span></div>`);
    document.querySelector('main').append(preferences);
    for (const [source, target] of [[document.querySelector('.theme-control .language-menu'), '.theme-options'], [document.querySelector('.language-control>.language-menu'), '.locale-options']]) {
      if (!source) continue;
      for (const original of source.querySelectorAll('button')) {
        const button = original.cloneNode(true); button.removeAttribute('role');
        button.onclick = () => original.click(); preferences.querySelector(target).append(button);
        const sync = () => button.setAttribute('aria-pressed', String(original.getAttribute('aria-checked') === 'true'));
        new MutationObserver(sync).observe(original, {attributes:true,attributeFilter:['aria-checked']}); sync();
      }
    }
    for (const section of preferences.querySelectorAll('.preferences-section')) {
      const group = document.createElement('div'); group.className = 'settings-group';
      section.querySelector('h2').after(group);
      for (const row of [...section.querySelectorAll('.preference-row')]) group.append(row);
    }
    const describe = (title, description) => {
      const heading = [...preferences.querySelectorAll('.preference-row h3')].find(item => item.textContent === I18n.t(title));
      const copy = document.createElement('div'); copy.className = 'setting-copy';
      heading.before(copy); copy.append(heading);
      const detail = document.createElement('p'); detail.textContent = I18n.t(description); copy.append(detail);
    };
    describe('主题','选择应用的外观主题。');
    describe('语言','选择界面的显示语言。');
    describe('刷新设置','按所选频率自动更新通道状态，关闭后仍可手动刷新。');
    describe('修改密码','修改 Web 管理台的登录密码。');
    describe('退出登录','结束当前登录会话。');
    const inlineRefresh = document.createElement('form'); inlineRefresh.className = 'inline-refresh';
    inlineRefresh.innerHTML = `<div class="refresh-options" role="group" aria-label="${I18n.t('刷新设置')}">${[[0,'关闭'],[5,'5秒'],[10,'10秒'],[30,'30秒'],[60,'1分钟']].map(([value,label])=>`<button type="button" data-seconds="${value}" aria-pressed="false">${I18n.t(label)}</button>`).join('')}</div><p class="setting-feedback" role="status"></p>`;
    preferences.querySelector('[data-setting=refresh]').replaceWith(inlineRefresh);
    let loadingRefresh=false, savingRefresh=false;
    const refreshFeedback=inlineRefresh.querySelector('.setting-feedback');
    const refreshOptions=[...inlineRefresh.querySelectorAll('button')];
    const disableRefresh=disabled=>refreshOptions.forEach(button=>button.disabled=disabled);
    const selectRefresh=seconds=>refreshOptions.forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.seconds)===seconds)));
    async function loadRefresh() {
      if(loadingRefresh||savingRefresh)return;loadingRefresh=true;
      disableRefresh(true);
      try {const result=await call('/api/settings/refresh');selectRefresh(result.seconds);refreshFeedback.textContent='';}
      catch(error){refreshFeedback.textContent=error.message;}
      finally{loadingRefresh=false;disableRefresh(false);}
    }
    inlineRefresh.onsubmit=event=>event.preventDefault();
    inlineRefresh.onclick=async event=>{
      const button=event.target.closest('[data-seconds]');
      if(!button||savingRefresh||loadingRefresh)return;savingRefresh=true;
      disableRefresh(true);refreshFeedback.textContent='';
      try {const result=await call('/api/settings/refresh',{seconds:Number(button.dataset.seconds)});selectRefresh(result.seconds);refreshFeedback.textContent='';}
      catch(error){refreshFeedback.textContent=error.message;refreshFeedback.classList.remove('success');}
      finally{savingRefresh=false;disableRefresh(false);}
    };
    const inlinePassword=document.createElement('form');inlinePassword.className='inline-password';
    inlinePassword.innerHTML=I18n.html('<label>新密码<input name="password" type="password" required minlength="8" maxlength="256" autocomplete="new-password" placeholder="至少 8 个字符"></label><div class="setting-controls"><p class="setting-feedback" role="status"></p><button type="submit" class="primary">保存密码</button></div>');
    preferences.querySelector('[data-setting=password]').replaceWith(inlinePassword);
    const passwordRow=inlinePassword.closest('.preference-row');
    passwordRow.classList.add('password-setting-row');
    const passwordSave=inlinePassword.querySelector('button[type=submit]');
    passwordSave.classList.replace('primary','secondary');
    const passwordInput=inlinePassword.querySelector('input');
    passwordInput.setAttribute('aria-label',I18n.t('新密码'));
    const passwordLabel=passwordInput.closest('label');
    passwordLabel.replaceWith(passwordInput);
    inlinePassword.querySelector('.setting-controls').prepend(passwordInput);
    inlinePassword.append(inlinePassword.querySelector('.setting-feedback'));
    let savingPassword=false;
    inlinePassword.onsubmit=async event=>{
      event.preventDefault();if(savingPassword)return;
      const body=Object.fromEntries(new FormData(inlinePassword)),feedback=inlinePassword.querySelector('.setting-feedback');feedback.textContent='';
      savingPassword=true;inlinePassword.querySelector('button').disabled=true;
      try{await call('/api/auth/password',body);inlinePassword.reset();location.reload();}
      catch(error){feedback.textContent=error.message;}
      finally{savingPassword=false;inlinePassword.querySelector('button').disabled=false;}
    };
    preferences.querySelector('[data-setting=logout]').onclick=()=>area.querySelector('[data-action=logout]').click();
    const setPreferences = open => {
      window.dispatchEvent(new Event('leave-dashboard'));
      preferences.hidden = !open; document.querySelector('main>.workspace').hidden = open; document.querySelector('main>header').hidden = open;
      if(open){loadRefresh();window.dispatchEvent(new Event('check-cli'));}
      else inlinePassword.reset();
      toggle.classList.toggle('active', open); toggle.setAttribute('aria-current', open ? 'page' : 'false');
      if (open) channelMenu.querySelectorAll('button').forEach(button => {button.classList.remove('active');button.setAttribute('aria-pressed','false');});
      else syncNavigation();
    };
    toggle.onclick = () => setPreferences(true);
    channelMenu.addEventListener('click', () => setPreferences(false));
    toggle.removeAttribute('aria-haspopup'); toggle.removeAttribute('aria-expanded');
    lucide.createIcons();
  }
  async function start() {
    let authenticated = false;
    try {
      const state = await call('/api/auth/status');
      authenticated = state.authenticated;
      if (!state.authenticated) { showLogin(state.configured); return; }
      for (const src of ['/terminal.js', '/jumpserver-ui.js', '/app.js']) {
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.body.append(script); });
      }
      settings();
      await new Promise((resolve,reject) => { const script = document.createElement('script'); script.src = '/dashboard.js'; script.onload=resolve;script.onerror=reject;document.body.append(script); });
      document.body.classList.remove('auth-locked');
      if (location.hash.split('?')[0] === '#/settings') {
        const heading=document.querySelector('.preferences-heading h1');
        heading.tabIndex=-1;
        heading.focus({preventScroll:true});
      }
    } catch (error) {
      I18n.mountPicker(login);
      if (!login.open) login.showModal();
      login.querySelector('.error').textContent = I18n.t(authenticated ? '页面资源加载失败，请重新加载或重启服务' : '无法读取登录状态，请刷新页面重试') + (error.message ? ` (${error.message})` : '');
      retryLogin.hidden = false;
      loginForm.querySelector('[type=submit]').disabled = true;
    }
  }
  start();
})();
