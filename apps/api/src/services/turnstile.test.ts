import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyTurnstile } from './turnstile.ts';

const config = { secretKey: 'secret' };
const reply = (body: unknown, status = 200) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

describe('verifyTurnstile', () => {
  it('skips the check when Turnstile is not configured', async () => {
    assert.equal(await verifyTurnstile(undefined, '1.1.1.1', null), true);
  });

  it('refuses a missing token when configured', async () => {
    assert.equal(await verifyTurnstile(null, '1.1.1.1', config, reply({ success: true })), false);
  });

  it('accepts a token Siteverify approves, sending the secret and address', async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl = ((_url: unknown, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    }) as typeof fetch;

    assert.equal(await verifyTurnstile('tok', '1.1.1.1', config, fetchImpl), true);
    assert.equal(sent?.get('secret'), 'secret');
    assert.equal(sent?.get('response'), 'tok');
    assert.equal(sent?.get('remoteip'), '1.1.1.1');
  });

  it('refuses a token Siteverify rejects', async () => {
    assert.equal(await verifyTurnstile('tok', 'unknown', config, reply({ success: false })), false);
  });

  it('fails closed when Siteverify errors or is unreachable', async () => {
    assert.equal(await verifyTurnstile('tok', 'unknown', config, reply({}, 500)), false);
    const down = (() => Promise.reject(new Error('network'))) as typeof fetch;
    assert.equal(await verifyTurnstile('tok', 'unknown', config, down), false);
  });
});
