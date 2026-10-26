import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
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
  /** Render once, somewhere stable; null when Turnstile is not configured. */
  widget: ReactNode;
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
 * keys behaves exactly as before. The widget runs in its default managed
 * mode, which is invisible unless Cloudflare wants a click.
 */
export function useBotCheck(siteKey: string | null): BotCheck {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        const api = window.turnstile;
        if (cancelled || !api || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          callback: setToken,
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        });
      })
      .catch(() => setToken(null));

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      setToken(null);
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return {
    widget: siteKey ? <div ref={container} className="bot-check" /> : null,
    blocked: siteKey !== null && token === null,
    options: () => (token ? { headers: { 'x-turnstile-token': token } } : undefined),
    reset,
  };
}
