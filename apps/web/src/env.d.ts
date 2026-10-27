/**
 * The build-time variables this app reads. Declared so that a typo is a type
 * error rather than a silently undefined integration; every one is optional,
 * because a clone with nothing set has to build and run the same.
 */
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_PLAUSIBLE_SCRIPT_SRC?: string;
}

/** Set by vite.config.ts; names this build's service-worker caches. */
declare const __BUILD_ID__: string;
