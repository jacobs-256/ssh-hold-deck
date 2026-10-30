(() => {
  const login = document.createElement('dialog');
  login.id = 'login-dialog';
  login.innerHTML = I18n.html(`<form id="login-form"><div class="modal-head"><div><p class="login-brand">SSH Hold Deck</p><h2>密码登录</h2></div><i data-lucide="lock-keyhole"></i></div><label>密码<input name="password" type="password" required maxlength="256" autocomplete="current-password"></label><label id="login-confirm" hidden>确认密码<input name="confirmPassword" type="password" maxlength="256" autocomplete="new-password"></label><p class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">登录</button></div></form>`);
  document.body.append(login);
  const loginForm = login.querySelector('form');
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
    submitting = true; loginForm.querySelector('button').disabled = true;
    try { await call(setup ? '/api/auth/setup' : '/api/auth/login', body); location.reload(); }
    catch (e) {
      error.textContent = e.message;
      try { const state = await call('/api/auth/status'); if (state.configured && setup) { showLogin(true); error.textContent = I18n.t('密码已设置，请登录'); } } catch {}
    } finally { submitting = false; loginForm.querySelector('button').disabled = false; }
  };

  function settings() {
    const area = document.createElement('div'); area.className = 'account-settings';
    area.innerHTML = I18n.html(`<button type="button" class="settings-toggle" title="设置" aria-label="设置" aria-haspopup="menu" aria-expanded="false"><i data-lucide="settings"></i></button><div class="account-menu" role="menu" hidden><button type="button" role="menuitem" data-action="password"><i data-lucide="key-round"></i>修改密码</button><button type="button" role="menuitem" data-action="logout"><i data-lucide="log-out"></i>退出登录</button></div>`);
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
    lucide.createIcons();
  }
  async function start() {
    try {
      const state = await call('/api/auth/status');
      if (!state.authenticated) { showLogin(state.configured); return; }
      for (const src of ['/terminal.js', '/jumpserver-ui.js', '/app.js']) {
        await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.body.append(script); });
      }
      settings(); document.body.classList.remove('auth-locked');
    } catch {
      I18n.mountPicker(login);
      if (!login.open) login.showModal();
      login.querySelector('.error').textContent = I18n.t('无法读取登录状态，请刷新页面重试');
      loginForm.querySelector('button').disabled = true;
    }
  }
  start();
})();
