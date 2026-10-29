(() => {
  const panel=document.createElement('section');panel.className='terminal-panel';panel.hidden=true;
  panel.innerHTML=I18n.html('<div class="terminal-resize"></div><div class="terminal-bar"><div class="terminal-tabs" role="tablist"></div><button class="terminal-new" title="新建当前通道终端" aria-label="新建当前通道终端"><i data-lucide="plus"></i></button><button class="terminal-full" title="切换全屏" aria-label="切换全屏"><i data-lucide="maximize"></i></button><button class="terminal-hide" title="收起终端" aria-label="收起终端"><i data-lucide="chevron-down"></i></button></div><div class="terminal-content"></div>');
  document.body.append(panel);
  const dock=document.createElement('button');dock.className='terminal-dock';dock.hidden=true;dock.textContent=I18n.t('终端');document.body.append(dock);
  const sessions=new Map();let active;let counter=0;
  const terminalTheme=()=>document.documentElement.dataset.theme==='dark'
    ? {background:'#182b30',foreground:'#d7e0ea',cursor:'#55d8b4',selectionBackground:'#28645c88',black:'#182433',brightBlack:'#8c9fb5',white:'#ccd6e2',brightWhite:'#f0f5fa'}
    : {background:'#edf3f1',foreground:'#293b43',cursor:'#0b9284',selectionBackground:'#10b4a433',black:'#293b43',brightBlack:'#6b7d86',white:'#d5dfe3',brightWhite:'#edf3f5'};
  new MutationObserver(()=>{for(const session of sessions.values())session.term.options.theme=terminalTheme();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  const tabs=panel.querySelector('.terminal-tabs'),content=panel.querySelector('.terminal-content');
  lucide.createIcons();
  panel.querySelector('.terminal-new').onclick=()=>{const session=sessions.get(active);if(session)window.openTerminal(session.name);};
  const handle=panel.querySelector('.terminal-resize');
  handle.onpointerdown=event=>{if(panel.classList.contains('fullscreen'))return;handle.setPointerCapture(event.pointerId);};
  handle.onpointermove=event=>{if(handle.hasPointerCapture(event.pointerId)){panel.style.height=`${Math.max(220,Math.min(innerHeight-80,innerHeight-event.clientY))}px`;}};
  handle.onpointerup=event=>{if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
  function fit(){const session=sessions.get(active);if(session&&!panel.hidden){session.fit.fit();session.term.focus();}}
  function activate(id){active=id;panel.hidden=false;dock.hidden=true;for(const [key,s]of sessions){s.pane.hidden=key!==id;s.button.setAttribute('aria-selected',String(key===id));}sessions.get(id)?.tab.scrollIntoView({block:'nearest',inline:'nearest'});requestAnimationFrame(fit);}
  function close(id){const s=sessions.get(id);if(!s)return;s.ws?.close();s.term.dispose();s.pane.remove();s.tab.remove();sessions.delete(id);if(active===id){const next=[...sessions.keys()].at(-1);if(next)activate(next);else{active=null;panel.hidden=true;dock.hidden=true;}}}
  panel.querySelector('.terminal-hide').onclick=()=>{panel.hidden=true;dock.hidden=!sessions.size;};
  panel.querySelector('.terminal-full').onclick=()=>{const full=panel.classList.toggle('fullscreen');const button=panel.querySelector('.terminal-full');button.setAttribute('aria-pressed',String(full));button.innerHTML=`<i data-lucide="${full?'minimize':'maximize'}"></i>`;lucide.createIcons();requestAnimationFrame(fit);};
  dock.onclick=()=>activate(active);
  new ResizeObserver(fit).observe(content);
  window.openTerminal=async name=>{
    const id=++counter;const term=new Terminal({cursorBlink:true,fontSize:13,fontFamily:'Menlo, Monaco, monospace',scrollback:5000,theme:terminalTheme(),allowProposedApi:false});
    const fitAddon=new FitAddon.FitAddon();term.loadAddon(fitAddon);
    const tab=document.createElement('div');tab.className='terminal-tab';const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.innerHTML='<i data-lucide="terminal"></i>';const label=document.createElement('span');label.className='terminal-tab-label';label.textContent=`${name} · ${id}`;button.title=label.textContent;button.append(label);const exit=document.createElement('button');exit.type='button';exit.className='terminal-tab-close';exit.innerHTML='<i data-lucide="x"></i>';exit.title=I18n.t('关闭终端');exit.setAttribute('aria-label',I18n.t(`关闭 ${name} 终端`));tab.append(button,exit);tabs.append(tab);lucide.createIcons();
    const pane=document.createElement('div');pane.className='terminal-pane';content.append(pane);term.open(pane);const session={name,term,fit:fitAddon,tab,button,pane,ws:null};sessions.set(id,session);button.onclick=()=>activate(id);exit.onclick=()=>close(id);activate(id);term.writeln(I18n.t('\x1b[90m正在连接...\x1b[0m'));
    term.onResize(({cols,rows})=>{if(session.ws?.readyState===1)session.ws.send(JSON.stringify({type:'resize',cols,rows}));});
    term.onData(data=>{if(session.ws?.readyState===1)session.ws.send(JSON.stringify({type:'input',data}));});
    try{const response=await fetch(`/api/terminal/${encodeURIComponent(name)}`,{method:'POST'});const result=await response.json();if(!response.ok)throw Error(I18n.t(result.error));if(!sessions.has(id))return;const ws=new WebSocket(`ws://${location.host}/terminal?token=${result.token}`);session.ws=ws;
      ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.type==='output')term.write(msg.data);if(msg.type==='ready'){term.clear();ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}));}if(msg.type==='exit')term.writeln(I18n.t(`\r\n\x1b[90m终端已退出 (${msg.exitCode})\x1b[0m`));if(msg.type==='error')term.writeln(I18n.t(msg.message));};
      ws.onclose=()=>{label.textContent=I18n.t(`${name} · ${id} · 已结束`);button.title=label.textContent;term.writeln(I18n.t('\r\n\x1b[90m连接已关闭\x1b[0m'));};ws.onerror=()=>term.writeln(I18n.t('\r\n\x1b[31m终端连接失败\x1b[0m'));
    }catch(error){label.textContent=I18n.t(`${name} · ${id} · 失败`);button.title=label.textContent;term.writeln(`\r\n\x1b[31m${error.message}\x1b[0m`);}
  };
  window.addEventListener('beforeunload',()=>{for(const s of sessions.values())s.ws?.close();});
})();
