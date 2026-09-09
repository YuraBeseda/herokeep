import { Injectable, signal, type Signal } from '@angular/core';

/**
 * The non-standard `beforeinstallprompt` event Chromium browsers fire when a page qualifies for
 * an install prompt. Not part of `lib.dom.d.ts` (it never shipped as a cross-browser standard),
 * so the shape is declared locally from the (stable, widely documented) Chromium contract.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

// iPadOS 13+ reports its `userAgent` as a desktop Mac's, so the iPhone/iPod/iPad substring check
// alone misses iPads — the standard extra sniff is "claims to be a Mac but has touch points".
function looksLikeIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  const isIosUa = /iphone|ipad|ipod/.test(ua);
  const isIpadOs = ua.includes('macintosh') && navigator.maxTouchPoints > 1;
  return isIosUa || isIpadOs;
}

/**
 * Captures the Chromium `beforeinstallprompt` event and exposes it as an explicit `prompt()`
 * call the UI can trigger from a real user gesture (browsers require this — replaying a captured
 * event outside a user gesture is rejected). iOS Safari never fires `beforeinstallprompt` at all
 * (there is no programmatic install prompt), so `showIosHint` is exposed separately for the UI to
 * show "Add to Home Screen" instructions on that platform instead.
 */
@Injectable({ providedIn: 'root' })
export class InstallPromptService {
  private deferredEvent: BeforeInstallPromptEvent | null = null;

  private readonly canInstallState = signal(false);
  readonly canInstall: Signal<boolean> = this.canInstallState.asReadonly();

  readonly showIosHint: Signal<boolean> = signal(looksLikeIos()).asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (event) => {
      // Suppresses the browser's own default install UI so this service's captured event is the
      // only path to prompting — the app decides when/where to offer install, not the browser.
      event.preventDefault();
      this.deferredEvent = event as BeforeInstallPromptEvent;
      this.canInstallState.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredEvent = null;
      this.canInstallState.set(false);
    });
  }

  /**
   * Replays the captured `beforeinstallprompt` event. Resolves `true` when the user accepted the
   * install, `false` when dismissed or when no prompt had been captured (nothing to show).
   */
  async prompt(): Promise<boolean> {
    const event = this.deferredEvent;
    if (!event) return false;

    await event.prompt();
    const { outcome } = await event.userChoice;
    this.deferredEvent = null;
    this.canInstallState.set(false);
    return outcome === 'accepted';
  }
}
