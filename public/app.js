const $=s=>document.querySelector(s);let data=[];let editing=null;const connecting=new Set();
const channelEvents=new EventSource('/api/channels/events');
channelEvents.addEventListener('channels',event=>{
  const incoming=JSON.parse(event.data),names=new Set(incoming.map(channel=>channel.name));
  const comparable=({checkedAt,...channel})=>JSON.stringify(channel);
  for(const channel of incoming){if(connecting.has(channel.name))continue;const previous=data.find(row=>row.name===channel.name);if(!previous||comparable(previous)!==comparable(channel))updateChannel(channel);}
  if(data.some(channel=>!names.has(channel.name)&&!connecting.has(channel.name))){data=data.filter(channel=>names.has(channel.name)||connecting.has(channel.name));render();}
});
window.addEventListener('beforeunload',()=>channelEvents.close());
const tableWrap=$('.table-wrap'),tableScroll=document.createElement('div'),tableSlider=document.createElement('input');
tableScroll.className='table-scroll-control';tableSlider.type='range';tableSlider.min='0';tableSlider.step='1';tableSlider.setAttribute('aria-label',I18n.t('左右滚动通道列表'));tableScroll.append(tableSlider);tableWrap.before(tableScroll);
function syncTableScroll(){const max=Math.max(0,tableWrap.scrollWidth-tableWrap.clientWidth);tableScroll.hidden=max===0;tableSlider.max=String(max);tableSlider.value=String(tableWrap.scrollLeft);}
tableSlider.addEventListener('input',()=>{tableWrap.scrollLeft=Number(tableSlider.value);});
tableWrap.addEventListener('scroll',syncTableScroll,{passive:true});
tableWrap.addEventListener('wheel',event=>{if(!event.shiftKey||event.deltaX||!event.deltaY)return;const before=tableWrap.scrollLeft;tableWrap.scrollLeft+=event.deltaY;if(tableWrap.scrollLeft!==before)event.preventDefault();},{passive:false});
const tableResize=new ResizeObserver(syncTableScroll);tableResize.observe(tableWrap);tableResize.observe(tableWrap.querySelector('table'));syncTableScroll();
const jumpLabel=document.createElement('label');jumpLabel.textContent=I18n.t('跳板通道');const jumpSelect=document.createElement('select');jumpSelect.name='jump';jumpLabel.append(jumpSelect);$('#auth').closest('label').before(jumpLabel);
const messageDialog=document.createElement('dialog');messageDialog.className='message-dialog';messageDialog.innerHTML=I18n.html('<form method="dialog"><div class="message-heading"><span class="message-icon">!</span><h2></h2><button type="submit" value="cancel" class="message-close" aria-label="关闭">×</button></div><p class="message-body"></p><div class="message-actions"><button type="submit" value="cancel" class="secondary">取消</button><button type="submit" value="confirm" class="primary">确定</button></div></form>');document.body.appendChild(messageDialog);
let messageQueue=Promise.resolve();
function showMessage(message,confirmation=false){const task=messageQueue.then(()=>new Promise(resolve=>{messageDialog.querySelector('h2').textContent=confirmation?I18n.t('确认操作'):I18n.t('操作未完成');messageDialog.querySelector('.message-body').textContent=message;messageDialog.querySelector('.message-icon').textContent=confirmation?'?':'!';const cancel=messageDialog.querySelector('.message-actions .secondary');cancel.hidden=!confirmation;const primary=messageDialog.querySelector('.message-actions .primary');primary.textContent=confirmation?I18n.t('确定'):I18n.t('知道了');messageDialog.returnValue='';messageDialog.addEventListener('close',()=>resolve(messageDialog.returnValue==='confirm'),{once:true});messageDialog.showModal();(confirmation?cancel:primary).focus()}));messageQueue=task.catch(()=>{});return task;}
const identityInput=$('#form').elements.identity;const identityControls=document.createElement('span');identityControls.className='identity-controls';identityInput.before(identityControls);identityControls.append(identityInput);const identityPicker=document.createElement('input');identityPicker.type='file';identityPicker.hidden=true;identityPicker.id='identity-picker';const identityBrowse=document.createElement('button');identityBrowse.type='button';identityBrowse.className='secondary';identityBrowse.textContent=I18n.t('选择文件');identityControls.append(identityBrowse,identityPicker);let selectedIdentity=null;identityBrowse.onclick=()=>identityPicker.click();identityPicker.onchange=()=>{const file=identityPicker.files[0];if(!file)return;if(file.size>65536){$('#form-error').textContent=I18n.t('私钥文件不能超过 64KB');identityPicker.value='';return}selectedIdentity=file;identityInput.value=file.name;$('#form-error').textContent=''};identityInput.addEventListener('input',()=>{selectedIdentity=null;identityPicker.value=''});
const reloadButton=document.createElement('button');reloadButton.type='button';reloadButton.className='secondary';reloadButton.id='reload';reloadButton.textContent='Reload';reloadButton.title=I18n.t('从 ~/.ssh/hold 导入通道配置');$('#refresh').after(reloadButton);
reloadButton.onclick=async()=>{reloadButton.disabled=true;$('#refresh').disabled=true;reloadButton.textContent=I18n.t('导入中…');try{const result=await api('/api/channels/reload',{method:'POST'});data=result.channels;render();copyStatus.textContent=I18n.t(`已导入 ${result.imported} 个通道${result.skipped.length?I18n.t(`，跳过 ${result.skipped.length} 个无效配置`):''}`);copyStatus.classList.add('visible');clearTimeout(copyStatusTimer);copyStatusTimer=setTimeout(()=>copyStatus.classList.remove('visible'),3500)}catch(error){await showMessage(error.message)}finally{reloadButton.disabled=false;$('#refresh').disabled=false;reloadButton.textContent='Reload'}};
const copyStatus=document.createElement('div');copyStatus.className='copy-status';copyStatus.setAttribute('role','status');document.body.appendChild(copyStatus);let copyStatusTimer;
function decorateImportButton() {
  reloadButton.innerHTML = '<i data-lucide="download"></i>';
  reloadButton.classList.add('square');
  reloadButton.setAttribute('aria-label', reloadButton.title);
  lucide.createIcons();
}
const importAction = reloadButton.onclick;
reloadButton.onclick = async () => { await importAction(); decorateImportButton(); };
decorateImportButton();
$('#list').addEventListener('click',async event=>{const button=event.target.closest('.copy-name');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.name);copyStatus.textContent=I18n.t('通道名称已复制')}catch{copyStatus.textContent=I18n.t('复制失败，请检查浏览器剪贴板权限')}copyStatus.classList.add('visible');clearTimeout(copyStatusTimer);copyStatusTimer=setTimeout(()=>copyStatus.classList.remove('visible'),2200)});
document.querySelector('thead tr').insertAdjacentHTML('afterbegin','<th class="check"><input type="checkbox"></th>');
let sortKey = 'started', sortDirection = -1;
const sortKeys = ['name', 'target', 'gateway', 'auth', 'status', 'keepalive', 'started'];
const sortCollator = new Intl.Collator(I18n.language, { numeric: true, sensitivity: 'base' });
const sortHeaders = [...document.querySelectorAll('thead th')].slice(1, 8);
sortHeaders.forEach((header, index) => {
  const label = header.textContent;
  header.setAttribute('aria-sort', sortKeys[index] === sortKey ? 'descending' : 'none');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'column-sort';
  const text = document.createElement('span'); text.textContent = label;
  button.append(text);
  button.insertAdjacentHTML('beforeend', '<span class="sort-arrows" aria-hidden="true"><i data-lucide="chevron-up"></i><i data-lucide="chevron-down"></i></span>');
  header.replaceChildren(button);
  button.onclick = () => {
    const key = sortKeys[index];
    sortDirection = sortKey === key ? -sortDirection : 1; sortKey = key;
    sortHeaders.forEach((item, i) => item.setAttribute('aria-sort', sortKeys[i] === key ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none'));
    goToPage(1);
  };
});
function sortValue(channel) {
  if (sortKey === 'gateway') return channel.source === 'jumpserver' ? channel.serverName || '' : channel.jump || I18n.t('直连');
  if (sortKey === 'auth') return channel.auth === 'jumpserver' ? 'JumpServer' : I18n.t(channel.auth === 'key' ? 'SSH 私钥' : '用户名 / 密码');
  if (sortKey === 'started') { const time = Date.parse(channel.started); return Number.isNaN(time) ? null : time; }
  if (sortKey === 'status' || sortKey === 'keepalive') return I18n.t(channel[sortKey] || '');
  return channel[sortKey] || '';
}
function sortedChannels(rows) {
  if (!sortKey) return rows;
  return rows.sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const order = typeof left === 'number' ? left - right : sortCollator.compare(left, right);
    return sortDirection * order || sortCollator.compare(a.name, b.name);
  });
}
document.querySelectorAll('#modal .close, #modal .actions button[value="cancel"]').forEach(button=>{button.type='button';button.addEventListener('click',()=>$('#modal').close())});
async function api(url,opt={},retry=true){const r=await fetch(url,{headers:{'content-type':'application/json'},...opt});if(r.status===401){location.reload();throw Error(I18n.t('请重新登录'))}const x=await r.json();if(!r.ok){if(x.hostKeyChallenge&&retry){const key=x.hostKeyChallenge;const message=[I18n.t('SSH 主机指纹已变化'),key.host,I18n.t('原指纹'),...key.oldFingerprints,I18n.t('当前指纹'),key.fingerprint,I18n.t('请通过服务器控制台或管理员核实当前指纹。确认信任后将备份并更新本机记录，然后自动重连。')].join('\n');if(await showMessage(message,true)){await api('/api/host-keys/trust',{method:'POST',body:JSON.stringify({token:key.token})},false);return api(url,opt,false);}}throw Error(I18n.t(x.error||'请求失败'));}return x}
const jmsUI=createJumpServerUI({api,showMessage,changed:toggleAuth});
let currentPage=1,pageSize=20,pageCount=1;
try{const saved=Number(localStorage.getItem('channelPageSize'));if([10,20,50,100].includes(saved))pageSize=saved;}catch{}
const pagination=document.createElement('div');pagination.className='pagination';
pagination.innerHTML=I18n.html('<select aria-label="每页条数"><option value="10">10 / 页</option><option value="20">20 / 页</option><option value="50">50 / 页</option><option value="100">100 / 页</option></select><button type="button" data-page="first" title="首页" aria-label="首页"><i data-lucide="chevrons-left"></i></button><button type="button" data-page="previous" title="上一页" aria-label="上一页"><i data-lucide="chevron-left"></i></button><input type="number" min="1" step="1" aria-label="页码"><span class="page-count"></span><button type="button" data-page="next" title="下一页" aria-label="下一页"><i data-lucide="chevron-right"></i></button><button type="button" data-page="last" title="末页" aria-label="末页"><i data-lucide="chevrons-right"></i></button>');
$('#result-count').after(pagination);pagination.querySelector('select').value=String(pageSize);
function goToPage(page){currentPage=Math.max(1,Math.min(pageCount,page));tableWrap.scrollTop=0;render();}
pagination.querySelectorAll('button').forEach(button=>button.onclick=()=>goToPage(({first:1,previous:currentPage-1,next:currentPage+1,last:pageCount})[button.dataset.page]));
pagination.querySelector('input').onchange=event=>goToPage(Number.isInteger(Number(event.target.value))?Number(event.target.value):currentPage);
pagination.querySelector('select').onchange=event=>{pageSize=Number(event.target.value);try{localStorage.setItem('channelPageSize',String(pageSize));}catch{}goToPage(1);};
function render(){
  const q=$('#search').value.toLowerCase(),st=$('#status').value,a=$('#auth-filter').value;
  const rows=sortedChannels(data.filter(x=>(!q||[x.name,x.target,x.remote].join(' ').toLowerCase().includes(q))&&(!st||x.status===st)&&(!a||x.auth===a)));
  pageCount=Math.max(1,Math.ceil(rows.length/pageSize));currentPage=Math.min(currentPage,pageCount);
  const start=(currentPage-1)*pageSize,visible=rows.slice(start,start+pageSize),list=$('#list');
  const scrollTop=tableWrap.scrollTop,existing=new Map([...list.querySelectorAll('tr[data-channel]')].map(row=>[row.dataset.channel,row]));
  const keep=new Set();
  for(const channel of visible){
    let row=existing.get(channel.name);const {checkedAt,...snapshot}=channel;const signature=JSON.stringify(snapshot);
    if(!row||row.dataset.snapshot!==signature){
      const template=document.createElement('template');template.innerHTML=`<table><tbody>${rowHtml(channel)}</tbody></table>`;const replacement=template.content.querySelector('tr');replacement.dataset.snapshot=signature;
      if(row)row.replaceWith(replacement);row=replacement;
    }
    keep.add(row);
    const position=[...keep].length-1;if(list.children[position]!==row)list.insertBefore(row,list.children[position]||null);
  }
  for(const row of [...list.children])if(!keep.has(row))row.remove();
  if(!visible.length)list.innerHTML=I18n.html('<tr><td colspan="9" class="empty">没有符合条件的通道</td></tr>');
  $('#total').textContent=data.length;$('#up').textContent=data.filter(x=>x.status==='畅通').length;$('#down').textContent=data.filter(x=>x.status==='已断开').length;
  $('#result-count').textContent=`${rows.length?start+1:0}–${Math.min(start+pageSize,rows.length)} / ${rows.length}`;
  pagination.querySelector('input').value=String(currentPage);pagination.querySelector('input').max=String(pageCount);pagination.querySelector('.page-count').textContent=`/ ${pageCount}`;
  pagination.querySelectorAll('button').forEach(button=>button.disabled=['first','previous'].includes(button.dataset.page)?currentPage===1:currentPage===pageCount);
  lucide.createIcons();tableWrap.scrollTop=scrollTop;
}
function rowHtml(x){const gateway=x.source==='jumpserver'?x.serverName:x.jump||I18n.t('直连');return I18n.html(`<tr data-channel="${esc(x.name)}"><td class="check"><input type="checkbox" aria-label="${esc(x.name)}"></td><td><span class="channel-name"><span class="name" title="${esc(x.name)}">${esc(x.name)}</span><button type="button" class="copy-name" data-name="${esc(x.name)}" title="复制通道名称" aria-label="复制通道名称"><i data-lucide="copy"></i></button></span><span class="subtext">${esc(x.assetName||x.remote||I18n.t('本机通道'))}</span></td><td title="${esc(x.target)}">${esc(x.target)}</td><td title="${esc(gateway)}">${esc(gateway)}</td><td><span class="pill ${x.auth==='key'?'key':'auth'}">${x.auth==='jumpserver'?'JumpServer':x.auth==='key'?I18n.t('SSH 私钥'):I18n.t('用户名 / 密码')}</span></td><td><span class="pill ${x.status==='畅通'?'up':'down'}">${esc(I18n.t(x.status))}</span></td><td>${esc(I18n.t(x.keepalive||'-'))}</td><td>${esc(x.started||'-')}</td><td><div class="actions"><button type="button" title="打开终端" aria-label="打开终端" ${x.status!=='畅通'?'disabled':''} onclick="openTerminal('${esc(x.name)}')"><i data-lucide="terminal"></i></button><button class="connect-button ${x.status==='畅通'?'is-connected':'is-disconnected'}" ${x.status!=='畅通'&&!x.canConnect?'disabled':''} title="${esc(x.status==='畅通'?I18n.t('断开通道'):x.canConnect?I18n.t('连接通道'):x.connectDisabledReason||I18n.t('请先补全连接信息'))}" aria-label="${x.status==='畅通'?I18n.t('断开通道'):I18n.t('连接通道')}" onclick="reconnect('${esc(x.name)}')"><i data-lucide="power"></i></button><button title="编辑" aria-label="编辑" onclick="edit('${esc(x.name)}')"><i data-lucide="pencil"></i></button><button class="danger" title="删除" aria-label="删除" onclick="removeChannel('${esc(x.name)}')"><i data-lucide="trash-2"></i></button></div></td></tr>`);}
function updateChannel(channel){const index=data.findIndex(x=>x.name===channel.name);if(index<0)data.unshift(channel);else data[index]=channel;const row=[...$('#list').children].find(row=>row.dataset.channel===channel.name);if(row)delete row.dataset.snapshot;render();}
function esc(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
async function load(checkStatus=false){const list=$('#list'),refresh=$('#refresh');list.innerHTML=I18n.html('<tr><td colspan="9" class="loading"><span class="spinner"></span><span>正在读取通道列表...</span></td></tr>');refresh.disabled=true;try{const r=await api(checkStatus?'/api/channels/refresh':'/api/channels',checkStatus?{method:'POST'}:{});data=r.channels;render()}catch(e){list.innerHTML=I18n.html(`<tr><td colspan="9" class="empty error-state">读取失败：${esc(e.message)} <button id="retry" class="retry">重新加载</button></td></tr>`);$('#retry').onclick=()=>load(checkStatus)}finally{refresh.disabled=false}}
function openForm(row){editing=row?.name||null;$('#modal-title').textContent=editing?I18n.t('编辑通道'):I18n.t('新增通道');const f=$('#form');f.reset();jumpSelect.innerHTML=I18n.html('<option value="">不使用跳板（直接连接）</option>')+data.filter(x=>x.name!==editing).map(x=>`<option value="${esc(x.name)}">${esc(x.name)} · ${esc(I18n.t(x.status))}</option>`).join('');if(row?.jump&&!data.some(x=>x.name===row.jump))jumpSelect.insertAdjacentHTML('beforeend',I18n.html(`<option value="${esc(row.jump)}">${esc(row.jump)} · 不存在</option>`));jumpSelect.value=row?.jump||'';selectedIdentity=null;for(const k of ['name','identity'])f.elements[k].value=row?.[k]||'';const target=(row?.target||'').match(/^(.*):(\d+)$/);const destination=target?target[1]:row?.target||'';const separator=destination.lastIndexOf('@');f.elements.username.value=separator<0?'':destination.slice(0,separator);f.elements.host.value=separator<0?destination:destination.slice(separator+1);f.elements.port.value=target?target[2]:'22';f.elements.auth.value=row?.auth==='key'?'key':'password';f.elements.insecure.checked=Boolean(row?.insecure);f.elements.password.value='';f.elements.name.readOnly=!!editing;$('#form-error').textContent='';toggleAuth();$('#modal').showModal();jmsUI.open(row)}
function toggleAuth(){const key=$('#auth').value==='key';$('#password-field').hidden=key;$('#identity-field').hidden=!key;$('#submit').textContent=editing?I18n.t('保存修改'):I18n.t('保存并连接')}
$('#auth').onchange=toggleAuth;$('#add').onclick=()=>openForm();$('#refresh').onclick=()=>load(true);const resetPage=()=>goToPage(1);$('#search').oninput=resetPage;$('#status').onchange=resetPage;$('#auth-filter').onchange=resetPage;
let saving=false;
$('#modal').addEventListener('cancel',event=>{if(saving)event.preventDefault()});
$('#form').onsubmit=async e=>{e.preventDefault();if(saving)return;const f=new FormData(e.target),b=Object.fromEntries(f);try{Object.assign(b,jmsUI.payload())}catch(err){$('#form-error').textContent=err.message;return}if(b.source!=='jumpserver')b.target=`${b.username.trim()}@${b.host.trim()}`;delete b.username;delete b.host;b.insecure=f.get('insecure')==='on';const controls=[...e.target.elements];saving=true;$('#form-error').textContent='';controls.forEach(c=>c.disabled=true);$('#submit').innerHTML=I18n.html('<span class="spinner"></span>正在连接…');try{if(b.auth==='key'&&selectedIdentity)b.identityContent=await selectedIdentity.text();const result=await api(editing?'/api/channels/'+encodeURIComponent(editing):'/api/channels',{method:editing?'PUT':'POST',body:JSON.stringify(b)});updateChannel(result.channel);$('#modal').close()}catch(err){$('#form-error').textContent=err.message}finally{saving=false;controls.forEach(c=>c.disabled=false);jmsUI.apply()}};
window.edit=n=>openForm(data.find(x=>x.name===n));window.removeChannel=async n=>{if(await showMessage(I18n.t(`确定删除通道“${n}”？这会关闭当前连接。`),true)){try{await api('/api/channels/'+encodeURIComponent(n),{method:'DELETE'});await load()}catch(e){await showMessage(e.message)}}};window.reconnect=async n=>{if(connecting.has(n))return;const channel=data.find(x=>x.name===n);if(!channel)return;const disconnect=channel.status==='畅通';if(!disconnect&&!channel.canConnect)return;if(disconnect&&!await showMessage(I18n.t(`确定断开通道“${n}”？配置和凭据将保留。`),true))return;connecting.add(n);const row=[...$('#list').children].find(x=>x.dataset.channel===n);if(row){row.setAttribute('aria-busy','true');row.querySelectorAll('button').forEach(b=>b.disabled=true);const status=row.cells[5];status.innerHTML=`<span class="pill connecting"><span class="spinner"></span>${disconnect?I18n.t('正在断开...'):I18n.t('正在连接...')}</span>`}try{const result=await api('/api/channels/'+encodeURIComponent(n)+'?action='+(disconnect?'disconnect':'reconnect'),{method:'POST'});updateChannel(result.channel)}catch(e){updateChannel(disconnect?channel:{...channel,status:'连接失败',keepalive:'停了'});await showMessage(e.message)}finally{connecting.delete(n)}};load();
