import { addPage, AutoloadPage, i18n } from '@hydrooj/ui-default';

const page = new AutoloadPage('cas_sudo_page', async () => {
  const sudoPath = '/user/sudo';
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (currentPath !== sudoPath) return;

  const root = document.querySelector('.immersive--content') as HTMLElement | null;
  if (!root) return;

  const form = root.querySelector('form') as HTMLFormElement | null;
  if (!form) return;

  function hideNativeSudoUI() {
    root.querySelectorAll('.sudo-div, .confirm-div, .sudo-switch').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    form.style.display = 'none';
  }

  function showNativeSudoUI() {
    root.querySelectorAll('.sudo-div, .confirm-div, .sudo-switch').forEach((el) => {
      (el as HTMLElement).style.display = '';
    });
    form.style.display = '';
    root.querySelector('[data-cas-sudo-loading]')?.remove();
    root.querySelector('[data-cas-sudo-only]')?.remove();
  }

  function showLoading() {
    if (root.querySelector('[data-cas-sudo-loading]')) return;

    hideNativeSudoUI();

    const loading = document.createElement('div');
    loading.dataset.casSudoLoading = 'true';
    loading.className = 'row';

    loading.innerHTML = `
      <div class="columns">
        <div class="text-center supplementary inverse typo" style="padding: 1rem 0;">
          <p>${i18n('oauth_only.cas_sudo_loading')}</p>
        </div>
      </div>
    `;

    form.parentElement?.insertBefore(loading, form);
  }

  function showCasOnly(url: string) {
    root.querySelector('[data-cas-sudo-loading]')?.remove();
    hideNativeSudoUI();

    if (root.querySelector('[data-cas-sudo-only]')) return;

    const block = document.createElement('div');
    block.dataset.casSudoOnly = 'true';
    block.className = 'row';

    block.innerHTML = `
      <div class="columns">
        <div style="margin-top: 1rem;">
          <a href="${url}" class="inverse expanded rounded primary button">
            ${i18n('oauth_only.cas_sudo_button')}
          </a>
        </div>
        <div class="text-center supplementary inverse typo" style="margin-top: 1rem;">
          <p>${i18n('oauth_only.cas_sudo_hint')}</p>
        </div>
      </div>
    `;

    form.parentElement?.insertBefore(block, form.nextSibling);
  }

  showLoading();

  try {
    const resp = await fetch('/oauth/dlufl/sudo/status', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const data = await resp.json();

    if (data?.enabled && data?.url) {
      showCasOnly(data.url);
      return;
    }

    showNativeSudoUI();
  } catch {
    showNativeSudoUI();
  }
});

addPage(page);
export default page;