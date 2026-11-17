import { renderQrSvg } from '../vendor/qrcode.js';

async function copyTextSafe(text) {
  if (!text) return false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below for non-secure LAN HTTP origins.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

/**
 * Classroom projector QR code modal: fetches LAN URL via ./api/network-info
 * with a 1200ms timeout, renders a high-contrast white-padded SVG QR code,
 * and allows live URL editing and copying.
 */
export class QrModal {
  constructor({ triggerBtn, modalEl } = {}) {
    this.triggerBtn = triggerBtn || document.getElementById('qr-btn');
    this.modalEl = modalEl || document.getElementById('qr-modal');
    this.closeBtn = this.modalEl?.querySelector('#qr-close-btn') || null;
    this.cardEl = this.modalEl?.querySelector('#qr-code-card') || null;
    this.urlDisplayEl = this.modalEl?.querySelector('#qr-url-display') || null;
    this.urlInputEl = this.modalEl?.querySelector('#qr-url-input') || null;
    this.copyBtn = this.modalEl?.querySelector('#qr-copy-btn') || null;

    this.openState = false;
    this.hasCustomUrl = false;
    this.resolvedOnce = false;
    this.currentUrl = window.location.href;
    this.copyResetTimer = null;
    this.lastFocusEl = null;

    this.onKeyDown = (e) => {
      if (e.key === 'Escape' && this.openState) {
        e.preventDefault();
        this.close();
      }
    };

    this.bindEvents();
  }

  bindEvents() {
    this.triggerBtn?.addEventListener('click', () => {
      void this.open();
    });

    this.closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.modalEl?.addEventListener('click', (e) => {
      if (e.target === this.modalEl || e.target.hasAttribute('data-qr-backdrop')) {
        this.close();
      }
    });

    this.urlInputEl?.addEventListener('input', () => {
      this.hasCustomUrl = true;
      this.setUrl(this.urlInputEl.value, { syncInput: false });
    });

    this.copyBtn?.addEventListener('click', async () => {
      const value = this.currentUrl.trim();
      if (!value) return;
      const copied = await copyTextSafe(value);
      this.showCopyFeedback(copied ? 'Kopiert!' : 'Bitte manuell kopieren');
    });
  }

  showCopyFeedback(message) {
    if (!this.copyBtn) return;
    if (this.copyResetTimer) {
      window.clearTimeout(this.copyResetTimer);
    }
    if (!this.copyBtn.dataset.defaultLabel) {
      this.copyBtn.dataset.defaultLabel = this.copyBtn.textContent || 'URL kopieren';
    }
    this.copyBtn.textContent = message;
    this.copyBtn.classList.add('is-copied');
    this.copyResetTimer = window.setTimeout(() => {
      if (!this.copyBtn) return;
      this.copyBtn.textContent = this.copyBtn.dataset.defaultLabel || 'URL kopieren';
      this.copyBtn.classList.remove('is-copied');
      this.copyResetTimer = null;
    }, 2000);
  }

  async resolveInitialUrl() {
    const fallback = window.location.href;
    if (window.location.protocol === 'https:') {
      return fallback;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch('./api/network-info', {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) return fallback;
      const info = await response.json();
      const suggested =
        typeof info?.suggestedUrl === 'string' ? info.suggestedUrl.trim() : '';
      return suggested || fallback;
    } catch {
      return fallback;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  setUrl(nextUrl, { syncInput = true } = {}) {
    const raw = String(nextUrl ?? '');
    const trimmed = raw.trim();
    this.currentUrl = trimmed;

    if (syncInput && this.urlInputEl && this.urlInputEl.value !== raw) {
      this.urlInputEl.value = raw;
    }

    if (this.urlDisplayEl) {
      this.urlDisplayEl.textContent = trimmed
        ? trimmed.replace(/#pw=[^&]*/, '') + (/#pw=/.test(trimmed) ? '  ·  🔓 Passwort ist im Code' : '')
        : 'Keine URL eingegeben';
    }

    if (this.copyBtn) {
      this.copyBtn.disabled = !trimmed;
    }

    if (!this.cardEl) return;

    if (!trimmed) {
      this.cardEl.innerHTML =
        '<div class="qr-empty-hint">Bitte eine gültige URL eingeben</div>';
      return;
    }

    try {
      this.cardEl.innerHTML = renderQrSvg(trimmed, 8);
    } catch {
      this.cardEl.innerHTML =
        '<div class="qr-empty-hint">URL für QR-Code zu lang oder ungültig</div>';
    }
  }

  isOpen() {
    return this.openState;
  }

  async open() {
    if (!this.modalEl || this.openState) return;
    this.lastFocusEl = document.activeElement;
    this.openState = true;
    this.modalEl.hidden = false;
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.triggerBtn?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', this.onKeyDown);

    if (!this.hasCustomUrl) {
      this.setUrl(this.currentUrl);
      if (!this.resolvedOnce) {
        const resolved = await this.resolveInitialUrl();
        this.resolvedOnce = true;
        if (this.openState && !this.hasCustomUrl) {
          this.setUrl(resolved);
        } else if (!this.hasCustomUrl) {
          this.currentUrl = resolved;
        }
      }
    } else {
      this.setUrl(this.currentUrl, { syncInput: false });
    }

    window.requestAnimationFrame(() => {
      this.closeBtn?.focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.modalEl || !this.openState) return;
    this.openState = false;
    this.modalEl.hidden = true;
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.triggerBtn?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', this.onKeyDown);

    if (this.lastFocusEl && typeof this.lastFocusEl.focus === 'function') {
      this.lastFocusEl.focus({ preventScroll: true });
    }
    this.lastFocusEl = null;
  }

  toggle() {
    if (this.openState) {
      this.close();
    } else {
      void this.open();
    }
  }

  destroy() {
    this.close();
    if (this.copyResetTimer) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }
  }
}
