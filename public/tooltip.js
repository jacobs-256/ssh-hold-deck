(() => {
  const tooltip = document.createElement('div');
  tooltip.id = 'app-tooltip';
  tooltip.className = 'app-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let anchor = null;

  function adopt(element) {
    if (!(element instanceof Element) || !element.hasAttribute('title')) return;
    const text = element.getAttribute('title').trim();
    if (text) element.setAttribute('data-tooltip', text);
    else element.removeAttribute('data-tooltip');
    element.removeAttribute('title');
    if (element === anchor && !tooltip.hidden) {
      if (text) show(element);
      else hide();
    }
  }
  function adoptTree(root) {
    if (!(root instanceof Element)) return;
    adopt(root);
    for (const element of root.querySelectorAll('[title]')) adopt(element);
  }
  adoptTree(document.body);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') adopt(record.target);
      else for (const node of record.addedNodes) adoptTree(node);
    }
    if (anchor && !anchor.isConnected) hide();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  function content(element) {
    const translate = value => window.I18n ? (I18n.attribute ? I18n.attribute(value) : I18n.t(value)) : value;
    if (element.classList.contains('channel-platform')) return {
      title: element.dataset.system || translate('未知'),
      detail: element.dataset.architecture || '—',
    };
    const value = element.getAttribute('data-tooltip');
    if (!value) return null;
    return {
      title: translate(value),
      detail: element.getAttribute('data-tooltip-detail') || '',
    };
  }
  function hide() {
    if (anchor) anchor.removeAttribute('aria-describedby');
    anchor = null;
    tooltip.hidden = true;
    tooltip.replaceChildren();
  }
  function show(element) {
    const value = content(element);
    if (!value) return;
    hide();
    anchor = element;
    const title = document.createElement('strong');
    title.textContent = value.title;
    tooltip.replaceChildren(title);
    if (value.detail) {
      const detail = document.createElement('span');
      detail.textContent = value.detail;
      tooltip.append(detail);
    }
    (element.closest('dialog[open]') || document.body).append(tooltip);
    tooltip.hidden = false;
    element.setAttribute('aria-describedby', tooltip.id);
    const rect = element.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    const sidebar = element.closest('.sidebar');
    if (sidebar && (document.body.classList.contains('sidebar-collapsed') || sidebar.getBoundingClientRect().width <= 100)) {
      const left = Math.min(innerWidth - box.width - 8, rect.right + 8);
      const top = Math.max(8, Math.min(innerHeight - box.height - 8, rect.top + rect.height / 2 - box.height / 2));
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${top}px`;
    } else {
      tooltip.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + rect.width / 2 - box.width / 2))}px`;
      tooltip.style.top = `${rect.top >= box.height + 14 ? rect.top - box.height - 8 : Math.min(innerHeight - box.height - 8, rect.bottom + 8)}px`;
    }
  }
  const target = node => {
    if (!(node instanceof Element)) return null;
    const element = node.closest('.channel-platform, [data-tooltip], [title]');
    if (!element) return null;
    adopt(element);
    return element.matches('.channel-platform') || element.hasAttribute('data-tooltip') ? element : null;
  };
  document.addEventListener('pointerover', event => {
    const element = target(event.target);
    if (element && element !== anchor) show(element);
  });
  document.addEventListener('pointerout', event => {
    if (anchor && anchor.contains(event.target) && !anchor.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', event => {
    const element = target(event.target);
    if (element) show(element);
  });
  document.addEventListener('focusout', event => {
    if (event.target === anchor) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('close', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('app-languagechange', hide);
  window.AppTooltip = { hide, show };
})();
