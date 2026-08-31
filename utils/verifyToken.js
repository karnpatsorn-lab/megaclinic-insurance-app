// Lightweight signed token so the self-service "add relative" step can prove
// the employee already passed identity verification (emp_id + last 4 of
// national ID) without us standing up a full account system for ~300 people.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'megaclinic-dev-secret-change-me';
const TTL_MS = 15 * 60 * 1000; // 15 minutes is plenty for one form session

function sign(empId) {
  const expires = Date.now() + TTL_MS;
  const payload = `${empId}.${expires}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verify(token, expectedEmpId) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [empId, expiresStr, sig] = decoded.split('.');
    if (empId !== expectedEmpId) return false;
    const expires = Number(expiresStr);
    if (!expires || Date.now() > expires) return false;
    const payload = `${empId}.${expiresStr}`;
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

module.exports = { sign, verify };
