import { useCallback, useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      size: 'flexible';
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'before-interactive-callback': () => void;
      'after-interactive-callback': () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error('Could not load the bot check.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

export type BotCheck = {
  /**
   * Ref for the element the widget mounts in: put it inside the form, just
   * above the submit button. Does nothing when Turnstile is not configured.
   */
  slot: (el: HTMLDivElement | null) => void;
  /** Whether a submit has to wait for (or has lost) its token. */
  blocked: boolean;
  /** Per-call fetch options carrying the token, for the better-auth client. */
  options: () => { headers: Record<string, string> } | undefined;
  /** Tokens are single use: call after every protected request. */
  reset: () => void;
};

/**
 * Cloudflare Turnstile for the credential forms. With no site key (the API
 * has Turnstile unconfigured) every part of this is inert, so a clone without
 * keys behaves exactly as before.
 *
 * `interaction-only` keeps the widget invisible, success badge included, unless
 * Cloudflare needs a click; the challenge then appears where the person is
 * already looking, between the last field and the submit button. `flexible`
 * lets it fill the form's width on a phone instead of a fixed 300px box.
 */
export function useBotCheck(siteKey: string | null): BotCheck {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey || !container) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        const api = window.turnstile;
        if (cancelled || !api) return;
        widgetId.current = api.render(container, {
          sitekey: siteKey,
          size: 'flexible',
          appearance: 'interaction-only',
          callback: setToken,
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
          // Collapsed by default (see `.bot-check`); open only for a real click.
          'before-interactive-callback': () => container.classList.add('needs-click'),
          'after-interactive-callback': () => container.classList.remove('needs-click'),
        });
      })
      .catch(() => setToken(null));

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      setToken(null);
    };
  }, [siteKey, container]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return {
    slot: setContainer,
    blocked: siteKey !== null && token === null,
    options: () => (token ? { headers: { 'x-turnstile-token': token } } : undefined),
    reset,
  };
}
