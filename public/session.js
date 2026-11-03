(() => {
  const originalFetch = window.fetch.bind(window);
  let active = false, redirecting = false, checking = false;
  function expire() {
    if (!active || redirecting) return;
    redirecting = true;
    document.body.classList.add('auth-locked');
    location.reload();
  }
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')
      && !['/api/auth/login', '/api/auth/setup', '/api/auth/status'].includes(url.pathname)
      && response.status === 401) expire();
    return response;
  };
  async function check() {
    if (!active || redirecting || checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const response = await originalFetch('/api/auth/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.ok && (await response.json()).authenticated === false) expire();
    } catch {
      // A sleeping service or temporary network failure does not imply logout.
    } finally { checking = false; }
  }
  window.Session = { activate() { active = true; }, check };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  setInterval(check, 60000);
})();
