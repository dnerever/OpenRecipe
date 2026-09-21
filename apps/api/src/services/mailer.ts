import { Resend } from 'resend';
import { mailer } from '../env.ts';

export const mailConfigured = mailer !== null;

const client = mailer ? new Resend(mailer.apiKey) : null;

/**
 * Sends the password reset link, or — with no transport configured — logs it
 * instead. That keeps a fresh clone able to exercise the whole reset flow
 * locally without a Resend account, the same way object storage degrades to a
 * 503 rather than a boot failure. `better-auth` awaits this itself and only
 * logs a failure, so a thrown error here never surfaces to the requester —
 * which is also correct: the endpoint must answer identically whether or not
 * the address exists, so it cannot report send failures to the caller either.
 */
export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  if (!client || !mailer) {
    console.log(`[mailer] No RESEND_API_KEY set. Reset link for ${to}:\n${url}`);
    return;
  }

  const { error } = await client.emails.send({
    from: mailer.from,
    to,
    subject: 'Reset your OpenRecipe password',
    html: `
      <p>Someone asked to reset the password for this OpenRecipe account.</p>
      <p><a href="${url}">Choose a new password</a></p>
      <p>If this wasn't you, you can ignore this email.</p>
    `,
  });

  if (error) throw new Error(`Resend failed to send: ${error.message}`);
}
