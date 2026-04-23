import { addPage, AutoloadPage } from '@hydrooj/ui-default';

const page = new AutoloadPage('cas_uni_logout_patch', () => {
  if ((window as any).__casUniLogoutPatched) return;
  (window as any).__casUniLogoutPatched = true;

  async function handleLogoutClick(ev: Event) {
    const target = ev.target as Element | null;
    const link = target?.closest?.('[name="nav_logout"]') as HTMLAnchorElement | null;
    if (!link) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (typeof (ev as any).stopImmediatePropagation === 'function') {
      (ev as any).stopImmediatePropagation();
    }

    const href = link.getAttribute('href') || '/logout';

    try {
      const resp = await fetch(href, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (data && data.url) {
          window.location.href = data.url;
          return;
        }
      }

      if (resp.redirected && resp.url) {
        window.location.href = resp.url;
        return;
      }

      window.location.reload();
    } catch {
      window.location.href = href;
    }
  }

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as Element | null;
      if (!target?.closest) return;

      const logoutLink = target.closest('[name="nav_logout"]');
      if (!logoutLink) return;

      void handleLogoutClick(ev);
    },
    true,
  );
});

addPage(page);
export default page;