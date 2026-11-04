/**
 * Platform services the application needs from its host. The browser
 * implementation uses standard web APIs only (no filesystem access is assumed).
 * A desktop shell (for example Tauri) can provide native dialogs by implementing
 * this interface; nothing else in the application touches these APIs directly.
 */

export interface Platform {
  readonly name: 'web' | 'desktop';
  /** Offers `data` to the user as a download / save. */
  save(name: string, data: Blob | Uint8Array | string, mime: string): Promise<void>;
  /** Lets the user pick a file. Resolves to null when cancelled. */
  open(accept: string): Promise<File | null>;
  toggleFullscreen(target?: HTMLElement): Promise<boolean>;
  isFullscreen(): boolean;
  registerServiceWorker(): Promise<'registered' | 'unsupported' | 'skipped' | 'failed'>;
}

class WebPlatform implements Platform {
  readonly name = 'web' as const;

  async save(name: string, data: Blob | Uint8Array | string, mime: string): Promise<void> {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  open(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      let settled = false;
      input.onchange = () => {
        settled = true;
        resolve(input.files?.[0] ?? null);
        input.remove();
      };
      // `cancel` is supported by modern browsers; older ones simply never resolve
      // the picker, which is harmless.
      input.addEventListener('cancel', () => {
        if (!settled) resolve(null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  async toggleFullscreen(target: HTMLElement = document.documentElement): Promise<boolean> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return false;
      }
      await target.requestFullscreen({ navigationUI: 'hide' });
      return true;
    } catch {
      return !!document.fullscreenElement;
    }
  }

  isFullscreen(): boolean {
    return !!document.fullscreenElement;
  }

  async registerServiceWorker(): Promise<'registered' | 'unsupported' | 'skipped' | 'failed'> {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    if (import.meta.env.DEV) return 'skipped';
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      return 'registered';
    } catch {
      return 'failed';
    }
  }
}

export const platform: Platform = new WebPlatform();

export function timestampName(prefix: string, ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'neuroform';
}
