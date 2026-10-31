(() => {
  const t = I18n.t;
  const symbol = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const page = document.createElement('section'); page.className='dashboard-page';
  page.innerHTML=I18n.html(`<div class="dashboard-heading"><h1>Dashboard</h1><p>SSH Hold Deck</p></div><div class="cli-banner" role="status"><span class="dashboard-symbol">${symbol('terminal')}</span><div class="cli-description"><h2>正在检测 ssh-hold…</h2><p></p></div><button type="button" class="secondary" data-cli="check" title="重新检测" aria-label="重新检测">${symbol('refresh-cw')}</button><button type="button" class="primary" data-cli="install" hidden>${symbol('download')}<span>安装 ssh-hold</span></button></div><div class="dashboard-stats">${[['total','全部通道','layers'],['up','畅通','circle-check'],['down','已断开','unplug']].map(([key,label,icon])=>`<button type="button" class="dashboard-stat" data-filter="${key}"><div><span>${t(label)}</span><strong data-stat="${key}">—</strong></div><span class="dashboard-symbol">${symbol(icon)}</span></button>`).join('')}</div><div class="dashboard-shortcuts"><button type="button" class="primary" data-shortcut="add">${symbol('plus')}添加通道</button><button type="button" class="secondary" data-shortcut="channels">${symbol('layers')}通道列表</button></div><section class="dashboard-recent"><h2>最近通道</h2><div class="recent-channels"></div></section>`);
  document.querySelector('main').append(page);
  const navigation=document.createElement('button');navigation.type='button';navigation.className='dashboard-nav';navigation.innerHTML=`${symbol('layout-dashboard')}<span>Dashboard</span>`;navigation.title='Dashboard';
  const nav=document.createElement('nav');nav.className='dashboard-navigation';nav.append(navigation);document.querySelector('.logo').after(nav);
  const list=document.querySelector('.recent-channels');
  const escape = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const recent = page.querySelector('.dashboard-recent');
  const columns = document.createElement('div'); columns.className = 'dashboard-columns';
  recent.before(columns);
  const skill = document.createElement('section'); skill.className = 'dashboard-skill';
  skill.innerHTML = `<div class="skill-heading"><h2>${t('ssh-hold 技能文档')}</h2></div><article class="skill-preview" tabindex="0" aria-label="${t('ssh-hold 技能文档')}" aria-busy="true"><p role="status">${t('正在加载文档…')}</p></article>`;
  columns.append(skill, recent);
  const preview = skill.querySelector('.skill-preview');
  const skillActions = document.createElement('div'); skillActions.className = 'skill-actions';
  skill.querySelector('.skill-heading').append(skillActions);
  const agentsBar = document.createElement('div'); agentsBar.className = 'skill-agents';
  agentsBar.setAttribute('role', 'group'); agentsBar.setAttribute('aria-label', t('AI Agent 技能管理'));
  skillActions.append(agentsBar);
  const agentStatus = document.createElement('p'); agentStatus.className = 'skill-agent-status';
  agentStatus.setAttribute('role', 'status'); skill.querySelector('.skill-heading').after(agentStatus);
  const agentSettings = document.querySelector('.agent-skills-settings');
  agentSettings.innerHTML = `<h3>${t('AI Agent 技能管理')}</h3><p class="skill-agent-status" role="status">${t('正在检测 AI Agent…')}</p><div class="agent-settings-grid"></div>`;
  const settingsGrid = agentSettings.querySelector('.agent-settings-grid');
  const settingsStatus = agentSettings.querySelector('[role=status]');
  let agents = [], agentOperation = false, detectingAgents = false;
  function renderAgents() {
    agentsBar.innerHTML = agents.map(agent => {
      const action = agent.skillInstalled ? t('卸载 ssh-hold skill') : t('安装 ssh-hold skill');
      const label = `${agent.name} · ${agent.error ? t('检测失败，请重试') : action}`;
      return `<button type="button" class="skill-agent ${agent.skillInstalled ? 'is-installed' : ''}" data-agent="${escape(agent.id)}" aria-label="${escape(label)}" title="${escape(label)}" aria-pressed="${Boolean(agent.skillInstalled)}" ${agentOperation || agent.error ? 'disabled' : ''}><img src="/assets/agents/${escape(agent.id)}.svg" width="18" height="18" alt=""><span class="agent-tooltip" role="tooltip">${escape(label)}</span></button>`;
    }).join('');
    settingsGrid.innerHTML = agents.map(agent => {
      const paths = agent.paths?.length ? agent.paths : agent.installPath ? [agent.installPath] : [];
      const label = `${agent.name} · ssh-hold skill`;
      return `<article class="agent-setting-card" data-agent-card="${escape(agent.id)}"><div class="agent-card-heading"><img src="/assets/agents/${escape(agent.id)}.svg" width="24" height="24" alt=""><h4>${escape(agent.name)}</h4><label class="service-switch"><input type="checkbox" role="switch" data-agent-switch="${escape(agent.id)}" aria-label="${escape(label)}" ${agent.skillInstalled ? 'checked' : ''} ${agentOperation || agent.error ? 'disabled' : ''}><span aria-hidden="true"></span></label></div><p class="agent-path-label">${t(agent.error ? '检测失败，请重试' : agent.skillInstalled ? '安装路径' : '待安装路径')}</p>${paths.map(file => `<code class="agent-install-path">${escape(file.replace(/[\\/]$/, '') + '/SKILL.md')}</code>`).join('')}</article>`;
    }).join('');
  }
  async function detectAgents() {
    if (detectingAgents || agentOperation) return;
    detectingAgents = true; agentsBar.setAttribute('aria-busy', 'true');
    settingsGrid.setAttribute('aria-busy', 'true');
    try {
      const result = await request('/api/system/agent-skills');
      if (agentOperation) return;
      agents = result.agents; renderAgents(); agentStatus.textContent = '';
      settingsStatus.textContent = agents.length ? '' : t('未检测到 AI Agent');
    } catch {
      if (agentOperation) return;
      for (const status of [agentStatus, settingsStatus]) {
        status.textContent = t('AI Agent 检测失败');
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('重试');
        retry.onclick = detectAgents; status.append(' ', retry);
      }
    } finally { detectingAgents = false; agentsBar.setAttribute('aria-busy', 'false'); settingsGrid.setAttribute('aria-busy', 'false'); }
  }
  async function toggleAgent(id, fromSettings = false) {
    if (agentOperation) return;
    const agent = agents.find(item => item.id === id); if (!agent || agent.error) return;
    agentOperation = true;
    try {
      if (agent.skillInstalled) {
        const affected = agents.filter(other => other.id !== agent.id && other.paths?.some(file => agent.paths.includes(file)));
        let message = `${t('确认卸载以下 AI Agent 的 ssh-hold skill：')} ${agent.name}？`;
        if (affected.length) message += `\n${t('共享目录也会影响：')} ${affected.map(item => item.name).join(', ')}`;
        if (!await showMessage(message, true)) return;
      }
      renderAgents(); agentsBar.setAttribute('aria-busy', 'true');
      settingsGrid.setAttribute('aria-busy', 'true');
      agentStatus.textContent = '';
      const response = await fetch(`/api/system/agent-skills/${agent.id}`, {
        method: agent.skillInstalled ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: agent.skillInstalled }),
      });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || t('请求失败'));
      agents = result.agents;
      settingsStatus.textContent = '';
    } catch (error) { await showMessage(error.message); }
    finally {
      agentOperation = false; agentsBar.setAttribute('aria-busy', 'false'); settingsGrid.setAttribute('aria-busy', 'false'); renderAgents();
      (fromSettings ? settingsGrid.querySelector(`[data-agent-switch="${agent.id}"]`) : agentsBar.querySelector(`[data-agent="${agent.id}"]`))?.focus();
    }
  }
  agentsBar.onclick = event => {
    const button = event.target.closest('[data-agent]'); if (button) toggleAgent(button.dataset.agent);
  };
  settingsGrid.onchange = event => {
    const input = event.target.closest('[data-agent-switch]'); if (!input) return;
    const agent = agents.find(item => item.id === input.dataset.agentSwitch);
    input.checked = Boolean(agent?.skillInstalled);
    toggleAgent(input.dataset.agentSwitch, true);
  };
  window.addEventListener('check-agent-skills', detectAgents);
  window.addEventListener('focus', () => { if (!page.hidden || !document.querySelector('.preferences-page').hidden) detectAgents(); });
  async function loadSkill() {
    preview.setAttribute('aria-busy', 'true');
    try {
      await Promise.all(['/vendor/marked.js', '/vendor/purify.js'].map(src => new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = src;
        script.onload = resolve; script.onerror = reject; document.head.append(script);
      })));
      const response = await fetch('/assets/ssh-hold-skill.md');
      if (!response.ok) throw new Error('Document load failed');
      preview.innerHTML = DOMPurify.sanitize(marked.parse(await response.text()), { USE_PROFILES: { html: true } });
      preview.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
    } catch {
      preview.innerHTML = `<p role="alert">${t('文档加载失败')}</p><button type="button" class="secondary">${t('重试')}</button>`;
      preview.querySelector('button').onclick = loadSkill;
    } finally { preview.setAttribute('aria-busy', 'false'); }
  }
  loadSkill();
  let visible=false, busy=false;
  function update() {
    for(const key of ['total','up','down'])page.querySelector(`[data-stat=${key}]`).textContent=document.getElementById(key).textContent;
    const rows=typeof data==='undefined'?[]:data;
    list.innerHTML=rows.length?rows.slice(0,6).map(row=>`<button type="button" class="recent-channel" data-channel="${escape(row.name)}"><span class="dashboard-symbol">${symbol('server')}</span><span class="recent-description"><b>${escape(row.name)}</b><small>${escape(row.target)}</small></span><span class="pill ${row.status==='畅通'?'up':'down'}">${escape(t(row.status||'未知'))}</span>${symbol('chevron-right')}</button>`).join(''):`<div class="dashboard-empty">${symbol('server')}<span>${t('暂无通道')}</span></div>`;
    if(visible) document.querySelectorAll('.sidebar button[data-status]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false');});
    lucide.createIcons();
  }
  async function request(url,method='GET') {
    const response=await fetch(url,{method,headers:{'content-type':'application/json'},cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error(result.error||t('请求失败'));return result;
  }
  const banner=page.querySelector('.cli-banner'),install=page.querySelector('[data-cli=install]'),check=page.querySelector('[data-cli=check]');
  const settingsBanner=banner.cloneNode(true);
  document.querySelector('.preferences-heading').after(settingsBanner);
  function syncBanners() {
    settingsBanner.hidden=banner.hidden;
    settingsBanner.querySelector('h2').textContent=banner.querySelector('h2').textContent;
    settingsBanner.querySelector('p').textContent=banner.querySelector('p').textContent;
    for(const action of ['install','check']) {
      const source=banner.querySelector(`[data-cli=${action}]`),target=settingsBanner.querySelector(`[data-cli=${action}]`);
      target.hidden=source.hidden;target.disabled=source.disabled;
    }
  }
  async function detect(installing=false) {
    if(busy)return;busy=true;install.disabled=true;check.disabled=true;
    banner.hidden=false;
    const title=banner.querySelector('h2'),description=banner.querySelector('p');
    title.textContent=t(installing?'正在安装 ssh-hold…':'正在检测 ssh-hold…');description.textContent='';
    syncBanners();
    try {
      const state=await request(installing?'/api/system/ssh-hold/install':'/api/system/ssh-hold',installing?'POST':'GET');
      if(typeof state.installed!=='boolean')throw Error(t('检测失败，请重试'));
      banner.hidden=state.installed;
      title.textContent=t('尚未安装 ssh-hold');
      description.textContent=t(state.supported===false?'当前系统不支持自动安装 ssh-hold':'安装到运行服务的用户目录 ~/.local/bin，安装后即可管理 SSH 通道。');
      install.hidden=state.supported===false;
    } catch(error) {title.textContent=t(installing?'安装失败':'检测失败，请重试');description.textContent=error.message;install.hidden=false;}
    finally {busy=false;install.disabled=false;check.disabled=false;syncBanners();lucide.createIcons();}
  }
  function hide(){visible=false;page.hidden=true;navigation.classList.remove('active');navigation.setAttribute('aria-current','false');}
  function show(){visible=true;page.hidden=false;document.querySelector('main>.workspace').hidden=true;document.querySelector('main>header').hidden=true;document.querySelector('.preferences-page').hidden=true;document.querySelector('.settings-toggle').classList.remove('active');document.querySelector('.settings-toggle').setAttribute('aria-current','false');navigation.classList.add('active');navigation.setAttribute('aria-current','page');update();detect();detectAgents();}
  function channels(filter='total') {document.querySelector(`.sidebar [data-status="${filter==='up'?'畅通':filter==='down'?'已断开':''}"]`).click();}
  window.addEventListener('leave-dashboard',hide);
  navigation.onclick=()=>{location.hash='/dashboard';show();};check.onclick=()=>detect();install.onclick=()=>detect(true);
  settingsBanner.querySelector('[data-cli=check]').onclick=()=>detect();
  settingsBanner.querySelector('[data-cli=install]').onclick=()=>detect(true);
  window.addEventListener('check-cli',()=>detect());
  page.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>channels(button.dataset.filter));
  page.querySelector('[data-shortcut=channels]').onclick=()=>channels();
  page.querySelector('[data-shortcut=add]').onclick=()=>{channels();document.querySelector('#add').click();};
  list.onclick=event=>{const row=event.target.closest('[data-channel]');if(!row)return;channels();document.querySelector('#search').value=row.dataset.channel;document.querySelector('#search').dispatchEvent(new Event('input'));};
  new MutationObserver(update).observe(document.querySelector('.summary'),{childList:true,subtree:true,characterData:true});
  function applyRoute() {
    const route=new URL(location.hash.slice(1)||'/dashboard',location.origin);
    if(route.pathname==='/settings') document.querySelector('.settings-toggle').click();
    else if(route.pathname==='/channels') {
      const status=route.searchParams.get('status')||'';
      const button=[...document.querySelectorAll('.sidebar [data-status]')].find(item=>item.dataset.status===status);
      (button||document.querySelector('.sidebar [data-status=""]')).click();
    } else {
      if(location.hash!=='#/dashboard')history.replaceState(null,'','#/dashboard');
      show();
    }
  }
  window.addEventListener('hashchange',applyRoute);
  applyRoute();
})();
