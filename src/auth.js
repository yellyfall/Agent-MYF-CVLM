import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}
export async function checkPassword(password, hash) {
  const [salt, encoded] = hash.split(':');
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function signSession(user, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({id:user.id, version:user.version, exp:now+8*3600000})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}
export function verifySession(token, secret, now = Date.now()) {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const wanted = createHmac('sha256',secret).update(payload).digest();
    const received = Buffer.from(signature,'base64url');
    if (received.length !== wanted.length || !timingSafeEqual(received,wanted)) return null;
    const data = JSON.parse(Buffer.from(payload,'base64url').toString());
    return data.exp > now ? data : null;
  } catch { return null; }
}
export function activeUser(user, now = Date.now()) {
  return !!user && user.status === 'active' && (!user.expires_at || Date.parse(user.expires_at+'T23:59:59.999Z') >= now);
}
