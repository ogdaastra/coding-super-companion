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
  /** Whether the application can be installed as a desktop app right now. */
  installState(): InstallState;
  /** Shows the host's install prompt. Resolves true if the user accepted. */
  install(): Promise<boolean>;
  /** Calls `cb` whenever `installState()` changes. Returns an unsubscribe function. */
  onInstallStateChange(cb: (state: InstallState) => void): () => void;
}

/**
 * - `app`: running as an installed app, in its own window.
 * - `available`: the browser offers installation now (`install()` will prompt).
 * - `installed`: installed from this page during this visit.
 * - `unavailable`: the browser does not offer installation here (unsupported
 *   browser, already installed, or its criteria are not met yet).
 */
export type InstallState = 'app' | 'available' | 'installed' | 'unavailable';

/** Chromium's install prompt event (not in the standard DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class WebPlatform implements Platform {
  readonly name = 'web' as const;
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private justInstalled = false;
  private readonly runningAsApp: boolean = false;
  private readonly installListeners = new Set<(state: InstallState) => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    const mode = (q: string) => window.matchMedia?.(`(display-mode: ${q})`).matches === true;
    this.runningAsApp = mode('standalone') || mode('window-controls-overlay') || mode('minimal-ui') || (navigator as { standalone?: boolean }).standalone === true;
    // The browser may offer installation before the interface exists, so the
    // offer is captured here, at module load, and kept until it is used.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.emitInstallState();
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.justInstalled = true;
      this.emitInstallState();
    });
  }

  installState(): InstallState {
    if (this.runningAsApp) return 'app';
    if (this.justInstalled) return 'installed';
    return this.deferredPrompt ? 'available' : 'unavailable';
  }

  async install(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) return false;
    // A prompt event can be used once; the browser fires a new one if the user
    // dismisses it and installation is still possible.
    this.deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      return choice.outcome === 'accepted';
    } finally {
      this.emitInstallState();
    }
  }

  onInstallStateChange(cb: (state: InstallState) => void): () => void {
    this.installListeners.add(cb);
    return () => this.installListeners.delete(cb);
  }

  private emitInstallState(): void {
    const state = this.installState();
    for (const cb of this.installListeners) cb(state);
  }

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
