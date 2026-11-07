function createJumpServerUI({ api, showMessage, changed }) {
  const form = document.querySelector('#form');
  const error = document.querySelector('#form-error');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const manual = document.createElement('fieldset');
  manual.className = 'connection-fields';
  const username = form.elements.username.closest('label');
  username.before(manual);
  for (const element of [username, form.elements.host.closest('.row'), form.elements.jump.closest('label'), form.elements.auth.closest('label'), document.querySelector('#password-field'), document.querySelector('#identity-field')]) manual.append(element);
  manual.insertAdjacentHTML('beforebegin', I18n.html('<label>连接来源<select name="source"><option value="manual">手动配置</option><option value="jumpserver">JumpServer 资产</option></select></label>'));
  const region = document.createElement('fieldset');
  region.className = 'connection-fields jms-fields';
  region.hidden = true;
  region.innerHTML = I18n.html(`
    <label>JumpServer<span class="asset-search"><select name="serverId" required></select><button type="button" class="icon-button" data-action="configure" title="配置 JumpServer" aria-label="配置 JumpServer"><i data-lucide="server-cog"></i></button></span></label>
    <label>资产搜索<span class="asset-search"><input type="search" name="assetSearch" placeholder="名称或 IP 地址" autocomplete="off"><button type="button" class="icon-button" data-action="search" title="搜索资产" aria-label="搜索资产"><i data-lucide="search"></i></button></span></label>
    <label>服务器资产<select name="assetId" size="6" required aria-label="服务器资产"></select></label>
    <div class="asset-pagination"><span role="status"></span><button type="button" class="icon-button" data-action="previous" title="上一页" aria-label="上一页"><i data-lucide="chevron-left"></i></button><button type="button" class="icon-button" data-action="next" title="下一页" aria-label="下一页"><i data-lucide="chevron-right"></i></button></div>
    <label>登录账号<select name="account" required></select></label>`);
  manual.before(region);
  const source = form.elements.source, serverSelect = form.elements.serverId;
  const sourceLabel = source.closest('label');
  const assetSelect = form.elements.assetId, accountSelect = form.elements.account;
  const pagination = region.querySelector('.asset-pagination span');
  let servers = [], offset = 0, count = 0, assetRequest = 0, accountRequest = 0, openRequest = 0, debounce;
  let selection = null;
  const settingsButton = document.querySelector('#jumpserver-menu');
  const enabledSwitch = document.querySelector('#jumpserver-enabled');
  const enabledLabel = enabledSwitch?.closest('label');
  let enabled = false, enabledKnown = false, announcedEnabled = null, switchBusy = true, pendingEnable = false;
  document.querySelector('#auth-filter').insertAdjacentHTML('beforeend', '<option value="jumpserver">JumpServer</option>');

  function syncEnabled() {
    const shown = pendingEnable || enabled;
    if (enabledSwitch) {
      enabledSwitch.checked = shown;
      enabledSwitch.disabled = switchBusy;
      const action = I18n.t(shown ? '停用 JumpServer' : '启用 JumpServer');
      enabledSwitch.setAttribute('aria-label', action);
      enabledLabel?.setAttribute('title', action);
    }
    const existing = source.querySelector('option[value="jumpserver"]');
    if (enabled) {
      if (!existing) source.insertAdjacentHTML('beforeend', I18n.html('<option value="jumpserver">JumpServer 资产</option>'));
    } else if (existing) {
      if (source.value === 'jumpserver') source.value = 'manual';
      existing.remove();
    }
    sourceLabel.hidden = !source.querySelector('option[value="jumpserver"]');
    if (enabledKnown && announcedEnabled !== enabled) {
      announcedEnabled = enabled;
      window.dispatchEvent(new CustomEvent('jumpserver-enabled-change', { detail: { enabled } }));
    }
  }
  function apply() {
    syncEnabled();
    const jumpserverSource = source.value === 'jumpserver';
    manual.hidden = jumpserverSource; manual.disabled = jumpserverSource;
    region.hidden = !jumpserverSource; region.disabled = !jumpserverSource;
    changed();
  }
  function updateServers(preferred) {
    serverSelect.innerHTML = I18n.html('<option value="">请选择 JumpServer</option>') + servers.map(s => `<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
    serverSelect.value = preferred || (servers.length === 1 ? servers[0].id : '');
  }
  async function refreshServers(preferred) {
    const result = await api('/api/jumpservers'); servers = result.servers;
    if (!pendingEnable && typeof result.enabled === 'boolean') { enabled = result.enabled; enabledKnown = true; }
    updateServers(preferred); syncEnabled();
    return result;
  }
  async function changeEnabled(next, { quiet = false } = {}) {
    const previous = enabled;
    enabled = next; switchBusy = true; syncEnabled();
    try {
      const result = await api('/api/jumpservers/enabled', { method: 'POST', body: JSON.stringify({ enabled: next }) });
      enabled = result.enabled === true;
      enabledKnown = true;
      return true;
    } catch (error) {
      enabled = previous;
      if (!quiet) await showMessage(error.message);
      return false;
    } finally {
      switchBusy = false; syncEnabled();
    }
  }
  function clearSelection() {
    selection = null; assetSelect.replaceChildren(); accountSelect.innerHTML = I18n.html('<option value="">请先选择资产</option>');
    accountRequest++; assetRequest++; count = 0; pagination.textContent = '';
    region.querySelector('[data-action=previous]').disabled = true;
    region.querySelector('[data-action=next]').disabled = true;
  }
  async function accounts(id, preferred) {
    const request = ++accountRequest;
    selection = null; accountSelect.innerHTML = I18n.html('<option value="">读取账号中…</option>');
    if (!id || !serverSelect.value) return;
    try {
      const result = await api(`/api/jumpservers/${serverSelect.value}/assets/${id}`);
      if (request !== accountRequest) return;
      selection = result.asset;
      accountSelect.innerHTML = I18n.html('<option value="">请选择账号</option>') + selection.accounts.map(a => `<option value="${escape(a.alias)}">${escape(a.username)} · ${escape(a.name)}</option>`).join('');
      accountSelect.value = preferred || (selection.accounts.length === 1 ? selection.accounts[0].alias : '');
      if (!selection.accounts.length) error.textContent = I18n.t('该资产没有可用的托管账号，或没有账号连接权限');
    } catch (e) { if (request === accountRequest) { accountSelect.innerHTML = I18n.html('<option value="">账号不可用</option>'); error.textContent = e.message; } }
  }
  async function searchAssets(preferred) {
    const request = ++assetRequest;
    const serverId = serverSelect.value;
    accountRequest++; selection = null;
    assetSelect.replaceChildren(); accountSelect.innerHTML = I18n.html('<option value="">请先选择资产</option>');
    error.textContent = ''; pagination.textContent = serverId ? I18n.t('正在读取资产…') : I18n.t('请先配置并选择 JumpServer');
    region.querySelector('[data-action=previous]').disabled = true;
    region.querySelector('[data-action=next]').disabled = true;
    if (!serverId) return;
    try {
      const query = new URLSearchParams({ search: form.elements.assetSearch.value, offset: String(offset) });
      const result = await api(`/api/jumpservers/${serverId}/assets?${query}`);
      if (request !== assetRequest || serverId !== serverSelect.value) return;
      count = result.count;
      assetSelect.innerHTML = result.results.map(a => `<option value="${escape(a.id)}" ${a.active ? '' : 'disabled'} title="${escape(a.name)} · ${escape(a.address)}">${escape(a.name)} · ${escape(a.address)}</option>`).join('');
      if (preferred?.assetId && !result.results.some(a => a.id === preferred.assetId)) assetSelect.insertAdjacentHTML('afterbegin', `<option value="${escape(preferred.assetId)}">${escape(preferred.assetName)} · ${escape(preferred.assetAddress)}</option>`);
      assetSelect.value = preferred?.assetId || '';
      pagination.textContent = count ? `${offset + 1}–${Math.min(offset + 30, count)} / ${count}` : I18n.t('没有匹配的资产');
      region.querySelector('[data-action=previous]').disabled = offset === 0;
      region.querySelector('[data-action=next]').disabled = offset + 30 >= count;
      if (preferred?.assetId) await accounts(preferred.assetId, preferred.account);
    } catch (e) { if (request === assetRequest) { pagination.textContent = I18n.t('资产读取失败'); error.textContent = e.message; } }
  }
  source.onchange = async () => {
    clearTimeout(debounce); clearSelection(); error.textContent = ''; apply();
    if (source.value === 'jumpserver') {
      try { await refreshServers(); offset = 0; await searchAssets(); } catch (e) { error.textContent = e.message; }
    }
  };
  serverSelect.onchange = () => { clearTimeout(debounce); offset = 0; searchAssets(); };
  assetSelect.onchange = () => { error.textContent = ''; accounts(assetSelect.value); };
  const search = () => { clearTimeout(debounce); offset = 0; searchAssets(); };
  form.elements.assetSearch.oninput = () => { clearSelection(); clearTimeout(debounce); debounce = setTimeout(search, 350); };
  form.elements.assetSearch.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search(); } };
  region.querySelector('[data-action=search]').onclick = search;
  region.querySelector('[data-action=previous]').onclick = () => { offset = Math.max(0, offset - 30); searchAssets(); };
  region.querySelector('[data-action=next]').onclick = () => { offset += 30; searchAssets(); };

  const dialog = document.createElement('dialog');
  dialog.id = 'jumpserver-settings';
  dialog.innerHTML = I18n.html(`<form id="jumpserver-settings-form">
    <div class="modal-head"><h2>JumpServer 配置</h2><button type="button" class="close" data-action="close" aria-label="关闭">×</button></div>
    <label>配置<select name="saved"><option value="">新增 JumpServer</option></select></label>
    <label>名称<input name="name" required maxlength="100" autocomplete="off"></label>
    <label>HTTPS API 地址<input name="url" type="url" required placeholder="https://jumpserver.example.com:8236"></label>
    <label>Key ID<input name="keyId" required autocomplete="off"></label>
    <label>Key Secret<input name="keySecret" type="password" autocomplete="new-password"></label>
    <label>组织<span class="asset-search"><select name="orgId" required><option value="">请选择组织</option></select><button type="button" class="icon-button" data-action="organizations" title="刷新组织列表" aria-label="刷新组织列表"><i data-lucide="refresh-cw"></i></button></span></label>
    <div class="row"><label>SSH 网关<input name="sshHost" required placeholder="jumpserver.example.com"></label><label>SSH 端口<input name="sshPort" type="number" min="1" max="65535" value="2222" required></label></div>
    <p class="settings-status" role="status"></p>
    <div class="actions"><button type="button" class="danger secondary" data-action="delete" title="删除配置" aria-label="删除配置"><i data-lucide="trash-2"></i></button><button type="button" class="secondary" data-action="test">测试连接</button><button type="submit" class="primary">保存</button></div>
  </form>`);
  document.body.append(dialog);
  const settingsForm = dialog.querySelector('form'), status = dialog.querySelector('.settings-status');
  const closeButton = dialog.querySelector('[data-action=close]');
  let settingsBusy = false;
  const secretInput=settingsForm.elements.keySecret;
  const secretControls=document.createElement('div');secretControls.className='secret-controls';secretInput.before(secretControls);secretControls.append(secretInput);
  const eye=document.createElement('button');eye.type='button';eye.className='icon-button';eye.hidden=true;eye.title=I18n.t('查看 Key Secret');eye.setAttribute('aria-label',eye.title);eye.innerHTML='<i data-lucide="eye"></i>';secretControls.append(eye);
  const reveal=document.createElement('dialog');reveal.id='secret-reveal-dialog';
  reveal.innerHTML=I18n.html('<form><div class="modal-head"><h2>查看 Key Secret</h2><button type="button" class="close" aria-label="关闭">×</button></div><label>当前登录密码<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><label class="revealed-secret" hidden>Key Secret<input readonly autocomplete="off" spellcheck="false"></label><p class="error" role="alert"></p><div class="actions"><button type="button" class="secondary">关闭</button><button type="submit" class="primary">验证并查看</button></div></form>');document.body.append(reveal);
  reveal.querySelector('.revealed-secret').remove();
  const revealForm=reveal.querySelector('form');let revealBusy=false,revealVersion=0,verifiedSecret=null,secretVisible=false;
  function clearReveal(){revealVersion++;revealForm.reset();reveal.querySelector('.error').textContent='';}
  function updateEye(){secretInput.type=secretVisible?'text':'password';eye.innerHTML=`<i data-lucide="${secretVisible?'eye-off':'eye'}"></i>`;eye.title=I18n.t(secretVisible?'隐藏 Key Secret':'查看 Key Secret');eye.setAttribute('aria-label',eye.title);eye.setAttribute('aria-pressed',String(secretVisible));lucide.createIcons();}
  function resetSecret(){verifiedSecret=null;secretVisible=false;secretInput.value='';clearReveal();updateEye();}
  eye.onclick=()=>{if(verifiedSecret!==null){secretVisible=!secretVisible;if(secretVisible&&!secretInput.value)secretInput.value=verifiedSecret;updateEye();return;}clearReveal();reveal.showModal();lucide.createIcons();revealForm.elements.password.focus();};
  reveal.querySelectorAll('.close,.secondary').forEach(button=>button.onclick=()=>{clearReveal();reveal.close();});
  reveal.addEventListener('cancel',clearReveal);
  reveal.addEventListener('close',clearReveal);
  dialog.addEventListener('close',()=>{reveal.close();resetSecret();});
  revealForm.onsubmit=async event=>{
    event.preventDefault();if(revealBusy)return;revealBusy=true;const version=revealVersion,id=settingsForm.elements.saved.value,submit=revealForm.querySelector('[type=submit]');submit.disabled=true;reveal.querySelector('.error').textContent='';
    try{const result=await api(`/api/jumpservers/${encodeURIComponent(id)}/secret`,{method:'POST',body:JSON.stringify({password:revealForm.elements.password.value})});
      if(version!==revealVersion||!reveal.open||id!==settingsForm.elements.saved.value)return;
      verifiedSecret=result.keySecret;secretInput.value=verifiedSecret;secretVisible=true;updateEye();reveal.close();
    }catch(error){if(version===revealVersion)reveal.querySelector('.error').textContent=error.message;}
    finally{revealForm.elements.password.value='';revealBusy=false;submit.disabled=false;}
  };
  let organizationRequest = 0, organizationsLoading = false, organizationDebounce;
  const orgSelect = settingsForm.elements.orgId;
  async function loadOrganizations(preferred = orgSelect.value) {
    const request = ++organizationRequest;
    status.textContent = ''; status.classList.remove('success');
    const payload = settingsPayload();
    const existing = servers.find(s => s.id === payload.id);
    if (!payload.url || !payload.keyId || !payload.keySecret && !(existing?.url === payload.url && existing?.keyId === payload.keyId)) {
      organizationsLoading = false; orgSelect.disabled = false;
      orgSelect.innerHTML = I18n.html('<option value="">请先填写 API 地址和密钥</option>'); return;
    }
    organizationsLoading = true; orgSelect.disabled = true;
    orgSelect.innerHTML = I18n.html('<option value="">正在读取组织…</option>');
    try {
      const result = await api('/api/jumpservers/organizations', { method: 'POST', body: JSON.stringify({ ...payload, name: payload.name || 'JumpServer' }) });
      if (request !== organizationRequest) return;
      orgSelect.innerHTML = I18n.html('<option value="">请选择组织</option>') + result.organizations.map(org => `<option value="${escape(org.id)}" title="${escape(org.id)}">${escape(org.name)}</option>`).join('');
      orgSelect.value = result.organizations.some(org => org.id === preferred) ? preferred : result.organizations.find(org => org.isDefault)?.id || (result.organizations.length === 1 ? result.organizations[0].id : '');
      if (!result.organizations.length) status.textContent = I18n.t('当前用户没有可访问的组织');
    } catch (e) {
      if (request !== organizationRequest) return;
      orgSelect.innerHTML = preferred ? I18n.html(`<option value="${escape(preferred)}">${escape(preferred)}（当前配置）</option>`) : I18n.html('<option value="">组织读取失败</option>');
      status.classList.remove('success'); status.textContent = e.message;
    } finally { if (request === organizationRequest) { organizationsLoading = false; orgSelect.disabled = settingsBusy; } }
  }
  function populateSettings(id = '') {
    clearTimeout(organizationDebounce); organizationRequest++;
    const config = servers.find(s => s.id === id);
    settingsForm.reset(); settingsForm.elements.saved.value = id;
    for (const field of ['name', 'url', 'keyId', 'sshHost', 'sshPort']) if (config) settingsForm.elements[field].value = config[field];
    settingsForm.elements.keySecret.value = '';
    eye.hidden=!config?.hasSecret;resetSecret();
    settingsForm.elements.keySecret.required = !config;
    settingsForm.elements.keySecret.placeholder = config?.hasSecret ? '****************' : '';
    dialog.querySelector('[data-action=delete]').disabled = !config;
    status.textContent = ''; status.classList.remove('success');
    loadOrganizations(config?.orgId || '');
  }
  function settingsOptions(preferred = '') {
    settingsForm.elements.saved.innerHTML = I18n.html('<option value="">新增 JumpServer</option>') + servers.map(s => `<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
    populateSettings(preferred);
  }
  settingsButton.onclick = async () => {
    try {
      await refreshServers(serverSelect.value);
      settingsOptions(serverSelect.value || servers[0]?.id || ''); dialog.showModal(); settingsButton.setAttribute('aria-expanded', 'true'); lucide.createIcons();
    } catch (e) {
      if (pendingEnable) { pendingEnable = false; syncEnabled(); }
      await showMessage(e.message);
    }
  };
  settingsForm.elements.saved.onchange = () => populateSettings(settingsForm.elements.saved.value);
  region.querySelector('[data-action=configure]').onclick = () => settingsButton.click();
  dialog.querySelector('[data-action=organizations]').onclick = () => loadOrganizations();
  for (const field of ['url', 'keyId', 'keySecret']) settingsForm.elements[field].addEventListener('input', () => {
    clearTimeout(organizationDebounce); organizationRequest++; organizationsLoading = false;
    orgSelect.disabled = false; orgSelect.innerHTML = I18n.html('<option value="">请选择组织</option>');
    organizationDebounce = setTimeout(() => loadOrganizations(''), 500);
  });
  settingsForm.elements.url.addEventListener('change', () => { if (!settingsForm.elements.sshHost.value) { try { settingsForm.elements.sshHost.value = new URL(settingsForm.elements.url.value).hostname; } catch {} } });
  closeButton.onclick = () => { if (!settingsBusy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (settingsBusy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (pendingEnable) { pendingEnable = false; syncEnabled(); }
    clearTimeout(organizationDebounce); organizationRequest++; organizationsLoading = false; settingsForm.elements.keySecret.value = ''; settingsButton.setAttribute('aria-expanded', 'false');
  });
  function settingsPayload() { const payload = Object.fromEntries(new FormData(settingsForm)); if(verifiedSecret!==null&&payload.keySecret===verifiedSecret)payload.keySecret='';payload.id = payload.saved; delete payload.saved; return payload; }
  async function settingsAction(action) {
    if (action !== 'delete' && organizationsLoading) { status.textContent = I18n.t('正在读取组织，请稍候'); return; }
    if (settingsBusy || action !== 'delete' && !settingsForm.reportValidity()) return;
    const payload = settingsPayload();
    if (action === 'delete' && !await showMessage(I18n.t('确定删除该 JumpServer 配置？'), true)) return;
    settingsBusy = true;
    closeButton.disabled = true;
    const controls = [...settingsForm.elements]; controls.forEach(c => c.disabled = true);
    status.classList.remove('success'); status.textContent = action === 'test' ? I18n.t('正在验证认证和资产权限…') : I18n.t('正在保存…');
    try {
      if (action === 'test') {
        const result = await api('/api/jumpservers/test', { method: 'POST', body: JSON.stringify(payload) });
        status.textContent = I18n.t(`连接成功 · ${result.username} · ${result.assetCount} 个授权资产`); status.classList.add('success');
      } else {
        const endpoint = '/api/jumpservers' + (payload.id ? '/' + payload.id : '');
        const result = await api(endpoint, { method: action === 'delete' ? 'DELETE' : payload.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        await refreshServers(result.server?.id);
        settingsOptions(result.server?.id || '');
        status.textContent = action === 'delete' ? I18n.t('配置已删除') : I18n.t('配置已保存'); status.classList.add('success');
        if (action === 'save') {
          const activated = pendingEnable ? await changeEnabled(true, { quiet: true }) : true;
          pendingEnable = false;
          syncEnabled();
          dialog.close();
          if (!activated) await showMessage(I18n.t('启用 JumpServer 失败，请重试'));
        }
        if (document.querySelector('#modal').open && source.value === 'jumpserver') { offset = 0; await searchAssets(); }
      }
    } catch (e) { status.textContent = e.message; }
    finally { settingsBusy = false; closeButton.disabled = false; controls.forEach(c => c.disabled = false); orgSelect.disabled = organizationsLoading; dialog.querySelector('[data-action=delete]').disabled = !settingsForm.elements.saved.value; }
  }
  settingsForm.onsubmit = event => { event.preventDefault(); settingsAction('save'); };
  dialog.querySelector('[data-action=test]').onclick = () => settingsAction('test');
  dialog.querySelector('[data-action=delete]').onclick = () => settingsAction('delete');
  enabledSwitch?.addEventListener('change', async () => {
    if (switchBusy) { syncEnabled(); return; }
    if (!enabledSwitch.checked) { await changeEnabled(false); return; }
    pendingEnable = true;
    switchBusy = true; syncEnabled();
    try {
      await refreshServers();
      if (!servers.length) {
        settingsButton.click();
        return;
      }
      pendingEnable = false;
      await changeEnabled(true);
    } catch (error) {
      pendingEnable = false;
      await showMessage(error.message);
    } finally {
      switchBusy = false; syncEnabled();
    }
  });
  syncEnabled();
  refreshServers().catch(() => {}).finally(() => { switchBusy = false; syncEnabled(); });
  lucide.createIcons();
  return {
    apply,
    isEnabled: () => !enabledKnown || enabled,
    async open(row) {
      const request = ++openRequest;
      clearTimeout(debounce); clearSelection(); offset = 0;
      if (row?.source === 'jumpserver' && !source.querySelector('option[value="jumpserver"]')) source.insertAdjacentHTML('beforeend', I18n.html('<option value="jumpserver">JumpServer 资产</option>'));
      source.value = row?.source === 'jumpserver' ? 'jumpserver' : 'manual'; apply();
      try {
        await refreshServers(row?.serverId);
        if (request !== openRequest || !document.querySelector('#modal').open) return;
        if (row?.source === 'jumpserver' && !enabled) {
          document.querySelector('#modal').close();
          await showMessage(I18n.t('JumpServer 集成已停用，请先启用后再编辑该通道'));
          return;
        }
        if (source.value === 'jumpserver') await searchAssets(row);
      } catch (e) { if (request === openRequest) error.textContent = e.message; }
    },
    payload() {
      if (source.value !== 'jumpserver') return { source: 'manual' };
      if (!selection || selection.id !== assetSelect.value || !accountSelect.value) throw new Error(I18n.t('请选择有效的资产和登录账号'));
      return { source: 'jumpserver', serverId: serverSelect.value, assetId: selection.id, account: accountSelect.value };
    },
  };
}
