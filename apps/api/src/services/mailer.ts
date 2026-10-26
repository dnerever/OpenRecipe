import { Resend } from 'resend';
import { mailer } from '../env.ts';
import { captureException } from './sentry.ts';

export const mailConfigured = mailer !== null;

const client = mailer ? new Resend(mailer.apiKey) : null;

/**
 * Delivers one message, or — with no transport configured — logs `fallback`
 * instead. That keeps a fresh clone able to exercise every mail flow locally
 * without a Resend account, the same way object storage degrades to a 503
 * rather than a boot failure.
 *
 * A failed send is reported to Sentry and the log before it is rethrown:
 * `better-auth` awaits these itself and only logs a failure, so without this a
 * bad key or an unverified sender domain would be invisible. The error is
 * still thrown rather than surfaced to the requester, because the endpoints
 * that send must answer identically whether or not the address has an account.
 */
async function deliver(
  message: { to: string; subject: string; html: string },
  fallback: string,
): Promise<void> {
  if (!client || !mailer) {
    console.log(`[mailer] No RESEND_API_KEY set. ${fallback}`);
    return;
  }

  try {
    const { error } = await client.emails.send({ from: mailer.from, ...message });
    if (error) throw new Error(`Resend failed to send "${message.subject}": ${error.message}`);
  } catch (err) {
    console.error('[mailer] send failed', err);
    captureException(err);
    throw err;
  }
}

export function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  return deliver(
    {
      to,
      subject: 'Reset your OpenSkillet password',
      html: `
      <p>Someone asked to reset the password for this OpenSkillet account.</p>
      <p><a href="${url}">Choose a new password</a></p>
      <p>If this wasn't you, you can ignore this email.</p>
    `,
    },
    `Reset link for ${to}:\n${url}`,
  );
}

/** `code` is digits only, so it needs no HTML escaping. */
export function sendVerificationCodeEmail(to: string, code: string): Promise<void> {
  return deliver(
    {
      to,
      subject: `${code} is your OpenSkillet verification code`,
      html: `
      <p>Your OpenSkillet verification code is:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>
      <p>It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
    `,
    },
    `Verification code for ${to}: ${code}`,
  );
}
