import { APIError, betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { db, schema } from './db/index.ts';
import { env, githubOAuth } from './env.ts';
import { AccountHasForkedRecipesError, deleteAccount } from './services/account-deletion.ts';
import { claimUniqueHandle } from './services/handles.ts';
import { sendPasswordResetEmail, sendVerificationCodeEmail } from './services/mailer.ts';

/**
 * Mounted at `/auth` rather than better-auth's default `/api/auth`: the API is
 * served at the root and the web proxies `/api/*` to it, so this lands the
 * browser-facing routes on `/api/auth/*` with no doubled segment.
 */
export const auth = betterAuth({
  /**
   * The browser-visible origin, not the port this process binds. In
   * development Vite proxies `/api/*` through without rewriting; in production
   * this same process serves the SPA. Either way the path the browser uses and
   * the path this app serves are identical, which is what keeps the session
   * cookie first-party and OAuth callbacks correct. GitHub's callback URL is
   * `${APP_URL}/api/auth/callback/github`.
   */
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],

  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // Still off, on purpose: accounts that predate verification have
    // `emailVerified = false` and must keep signing in. New email accounts are
    // verified by the code flow below (`emailOTP`), which marks the address
    // verified before the account can set a password.
    requireEmailVerification: false,
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url);
    },
  },

  hooks: {
    // Sign-up has to go through the emailed code, or verifying would only deter
    // people who choose to. Read at request time, not from `env`, so a test can
    // exercise production's behaviour; outside production the direct endpoint
    // stays open because the suites and e2e cannot read an inbox.
    before: createAuthMiddleware((ctx) => {
      if (ctx.path === '/sign-up/email' && process.env['NODE_ENV'] === 'production') {
        throw APIError.from('FORBIDDEN', {
          code: 'email_verification_required',
          message: 'Create your account with the emailed verification code.',
        });
      }
      return Promise.resolve();
    }),
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      // Sign-up is the only use: password reset keeps its link, and existing
      // accounts are never forced through a code.
      sendVerificationOTP: async ({ email, otp }) => {
        await sendVerificationCodeEmail(email, otp);
      },
    }),
  ],

  // Off outside production by default; the code endpoints are the ones worth
  // limiting hardest, since a 6-digit code is only as strong as its guess cap.
  rateLimit: {
    customRules: {
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 10 },
    },
  },

  ...(githubOAuth ? { socialProviders: { github: githubOAuth } } : {}),

  user: {
    additionalFields: {
      handle: { type: 'string', required: false, input: true },
      bio: { type: 'string', required: false, input: false },
    },

    deleteUser: {
      enabled: true,
      // No `sendDeleteAccountVerification`: deletion happens immediately once
      // the request itself is authorized (password, or a fresh-enough
      // session — better-auth's own rule, see `sensitiveSessionMiddleware`).
      // A confirmation email would make this depend on the mail transport for
      // a destructive action nobody is locked out of by skipping it.
      beforeDelete: async (user) => {
        try {
          const handle = (user as { handle?: unknown }).handle;
          if (typeof handle !== 'string') throw new Error('user record has no handle');
          await deleteAccount(db, { id: user.id, handle });
        } catch (err) {
          if (err instanceof AccountHasForkedRecipesError) {
            throw APIError.from('BAD_REQUEST', {
              code: 'account_has_forked_recipes',
              message:
                'Some of your recipes have been forked by other people, and deleting your account would break their history. Make them private or get in touch instead.',
            });
          }
          throw err;
        }
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Every user needs a handle, but OAuth never gives us the chance to ask
         * for one — so derive it here and let the unique index arbitrate. Email
         * is lowercased for the same reason handles are: the unique index is
         * plain, not `lower()`.
         */
        before: async (user) => {
          const requested = (user as { handle?: unknown }).handle;
          const seed =
            typeof requested === 'string' && requested.trim() !== ''
              ? requested
              : (user.email ?? user.name ?? 'cook');

          return {
            data: {
              ...user,
              email: user.email?.toLowerCase() ?? user.email,
              handle: await claimUniqueHandle(db, seed),
            },
          };
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
