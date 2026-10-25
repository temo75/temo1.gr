import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const env = { FIREBASE_EMAIL: 'bridge@example.invalid', FIREBASE_PASSWORD: 'not-a-real-password', SESSION_SECRET: '0123456789abcdef0123456789abcdef' };
const originalUsers = [
  { id: 'user-1', name: 'Alice', email: 'alice@example.invalid', password: 'user-pass', authorized: true, blocked: false },
  { id: 'admin-1', name: 'TEMO', email: 'admin@example.invalid', password: 'admin-pass', admin: true, authorized: true, blocked: false }
];
let database;
let originalUsersSnapshot;

test.beforeEach(() => {
  database = { users: structuredClone(originalUsers), adminMessages: { 'user-1': [{ id: 'msg-1', userId: 'user-1', userName: 'Alice', text: 'Hello', createdAt: 10, reply: '', replyAt: 0, readByAdmin: false, replyReadByUser: true }] }, expenses: { 'user-1': [{ id: 'exp-1', category: '🛒 მაღაზია', amount: 12.5, date: '2026-10-26', createdAt: 1 }] }, jobs: { 'user-1': [{ id: 'job-1', date: '2026-10-01', place: 'local', money: 100, paid: false, updatedAt: 1 }] }, jobDeletes: { 'user-1': { old: 2 } } };
  originalUsersSnapshot = structuredClone(database.users);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'identitytoolkit.googleapis.com') return new Response(JSON.stringify({ idToken: 'firebase-service-token', expiresIn: '3600' }), { status: 200 });
    if (url.hostname !== 'temo-75-default-rtdb.europe-west1.firebasedatabase.app' || url.searchParams.get('auth') !== 'firebase-service-token') return new Response('denied', { status: 401 });
    const path = decodeURIComponent(url.pathname.replace(/^\//, '').replace(/\.json$/, '')).split('/');
    let value = database;
    for (const part of path) value = value?.[part];
    if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify(value ?? null), { status: 200 });
    if (init.method === 'PUT') {
      let target = database;
      for (const part of path.slice(0, -1)) target = target[part] ||= {};
      target[path[path.length - 1]] = JSON.parse(init.body);
      return new Response(JSON.stringify(target[path[path.length - 1]]), { status: 200 });
    }
    if (init.method === 'PATCH') {
      let target = database;
      for (const part of path.slice(0, -1)) target = target[part];
      const key = path[path.length - 1];
      const index = Array.isArray(target) ? Number(key) : key;
      target[index] = { ...target[index], ...JSON.parse(init.body) };
      return new Response(JSON.stringify(target[index]), { status: 200 });
    }
    if (init.method === 'DELETE') {
      let target = database;
      for (const part of path.slice(0, -1)) target = target?.[part];
      if (target && typeof target === 'object') delete target[path[path.length - 1]];
      return new Response('null', { status: 200 });
    }
    return new Response('method not allowed', { status: 405 });
  };
});

async function call(body, token) {
  return worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://temo1.gr', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(token ? { sessionToken: token } : {}) }) }), env);
}
async function login(username, password) {
  const response = await call({ action: 'login', username, password });
  return { response, body: await response.json() };
}

test('existing user and TEMO administrator credentials create signed sessions without returning passwords', async () => {
  const user = await login('Alice', 'user-pass');
  const admin = await login('TEMO', 'admin-pass');
  assert.equal(user.response.status, 200);
  assert.equal(user.body.user.admin, false);
  assert.equal(user.body.user.password, undefined);
  const claims = JSON.parse(Buffer.from(user.body.sessionToken.split('.')[0], 'base64url').toString());
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.exp > Math.floor(Date.now() / 1000), true);
  assert.equal(claims.password, undefined);
  assert.equal(typeof claims.credential, 'string');
  assert.notEqual(claims.credential, 'user-pass');
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.user.admin, true);
  assert.equal(admin.body.user.name, 'TEMO');
  assert.equal((await login('Alice', 'wrong')).response.status, 401);
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('user reads and sends only own messages; client cannot forge admin replies', async () => {
  const { body } = await login('Alice', 'user-pass');
  const read = await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(read.status, 200);
  assert.equal((await read.json())[0].text, 'Hello');
  assert.equal((await call({ action: 'db', path: 'adminMessages/admin-1', method: 'GET' }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'adminMessages/admin-1', method: 'PUT', data: [] }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'adminMessages', method: 'GET' }, body.sessionToken)).status, 403);
  const write = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: [
    { id: 'msg-1', userId: 'admin-1', userName: 'Fake', text: 'Hello', reply: 'forged admin reply', replyAt: 20, createdAt: 10 },
    { id: 'msg-2', text: 'New question', reply: 'forged', replyAt: 30, createdAt: 40 }
  ] }, body.sessionToken);
  assert.equal(write.status, 200);
  assert.equal(database.adminMessages['user-1'][0].userId, 'user-1');
  assert.equal(database.adminMessages['user-1'][0].userName, 'Alice');
  assert.equal(database.adminMessages['user-1'][0].reply, '');
  assert.equal(database.adminMessages['user-1'][1].reply, '');
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('only TEMO can delete an individual admin message thread through Firebase auth', async () => {
  const { body: userSession } = await login('Alice', 'user-pass');
  const path = 'adminMessages/user-1';
  assert.equal((await call({ action: 'db', path, method: 'DELETE' }, userSession.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path, method: 'DELETE' })).status, 401);
  assert.equal(database.adminMessages['user-1'].length, 1);

  const { body: adminSession } = await login('TEMO', 'admin-pass');
  const deleted = await call({ action: 'db', path, method: 'DELETE' }, adminSession.sessionToken);
  assert.equal(deleted.status, 200);
  assert.equal(database.adminMessages['user-1'], undefined);
  assert.deepEqual(database.users, originalUsersSnapshot);
  assert.equal((await call({ action: 'db', path: 'adminMessages', method: 'DELETE' }, adminSession.sessionToken)).status, 400);
});

test('only TEMO can block or unblock one non-admin user', async () => {
  const { body: aliceSession } = await login('Alice', 'user-pass');
  const forbidden = await call({ action: 'userBlock', userId: 'user-1', blocked: true }, aliceSession.sessionToken);
  assert.equal(forbidden.status, 403);
  assert.equal(database.users[0].blocked, false);

  const { body: adminSession } = await login('TEMO', 'admin-pass');
  const blocked = await call({ action: 'userBlock', userId: 'user-1', blocked: true }, adminSession.sessionToken);
  assert.equal(blocked.status, 200);
  assert.deepEqual(await blocked.json(), { userId: 'user-1', blocked: true, authorized: false });
  assert.equal(database.users[0].blocked, true);
  assert.equal(database.users[0].authorized, false);
  assert.equal(database.users[0].name, originalUsers[0].name);
  assert.equal(database.users[0].password, originalUsers[0].password);
  assert.equal(database.users[1].name, 'TEMO');

  assert.equal((await call({ action: 'session' }, aliceSession.sessionToken)).status, 401);
  const unblocked = await call({ action: 'userBlock', userId: 'user-1', blocked: false }, adminSession.sessionToken);
  assert.equal(unblocked.status, 200);
  assert.equal(database.users[0].blocked, false);
  assert.equal(database.users[0].authorized, true);

  assert.equal((await call({ action: 'userBlock', userId: 'admin-1', blocked: true }, adminSession.sessionToken)).status, 403);
  assert.equal((await call({ action: 'userBlock', userId: '../users', blocked: true }, adminSession.sessionToken)).status, 400);
  assert.equal((await call({ action: 'userBlock', userId: 'user-1', blocked: 'true' }, adminSession.sessionToken)).status, 400);
  assert.deepEqual(database.users[1], originalUsers[1]);
});

test('Firebase rejection leaves a user unblocked and returns a safe failure', async () => {
  const { body: adminSession } = await login('TEMO', 'admin-pass');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'temo-75-default-rtdb.europe-west1.firebasedatabase.app' &&
        init.method === 'PATCH' && url.pathname.includes('/users/0.json')) {
      return new Response('permission denied', { status: 401 });
    }
    return originalFetch(input, init);
  };
  try {
    const response = await call({ action: 'userBlock', userId: 'user-1', blocked: true }, adminSession.sessionToken);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'Firebase user update failed');
    assert.equal(database.users[0].blocked, false);
    assert.equal(database.users[0].authorized, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin user block locates object-keyed users without replacing sibling accounts', async () => {
  database.users = { aliceKey: structuredClone(originalUsers[0]), temoKey: structuredClone(originalUsers[1]) };
  originalUsersSnapshot = structuredClone(database.users);
  const { body: adminSession } = await login('TEMO', 'admin-pass');
  const response = await call({ action: 'userBlock', userId: 'user-1', blocked: true }, adminSession.sessionToken);
  assert.equal(response.status, 200);
  assert.equal(database.users.aliceKey.blocked, true);
  assert.equal(database.users.aliceKey.authorized, false);
  assert.equal(database.users.aliceKey.password, 'user-pass');
  assert.deepEqual(database.users.temoKey, originalUsers[1]);
});

test('site and bridge user-key encoding agree for non-UUID legacy IDs', async () => {
  const legacy = { id: 'legacy/user 7', name: 'Legacy', password: 'legacy-pass', authorized: true, blocked: false };
  database.users.push(legacy);
  const key = 'legacy_2Fuser_207';
  database.adminMessages[key] = [{ id: 'legacy-msg', userId: legacy.id, userName: legacy.name, text: 'Legacy thread', createdAt: 1, reply: '', replyAt: 0, replyReadByUser: true }];
  const { response, body } = await login('Legacy', 'legacy-pass');
  assert.equal(response.status, 200);
  const own = await call({ action: 'db', path: 'adminMessages/' + key, method: 'GET' }, body.sessionToken);
  assert.equal(own.status, 200);
  assert.equal((await own.json())[0].userId, legacy.id);
  assert.equal((await call({ action: 'db', path: 'adminMessages/legacy_2Fuser_208', method: 'GET' }, body.sessionToken)).status, 403);
});

test('admin reads inbox and replies without overwriting user content or account data', async () => {
  const { body } = await login('TEMO', 'admin-pass');
  const inbox = await call({ action: 'db', path: 'adminMessages', method: 'GET' }, body.sessionToken);
  assert.equal(inbox.status, 200);
  const write = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: [
    { ...database.adminMessages['user-1'][0], text: 'tampered', userName: 'tampered', reply: 'We will help.', replyAt: 25, readByAdmin: true, replyReadByUser: true }
  ] }, body.sessionToken);
  assert.equal(write.status, 200);
  const saved = database.adminMessages['user-1'][0];
  assert.equal(saved.text, 'Hello');
  assert.equal(saved.userName, 'Alice');
  assert.equal(saved.reply, 'We will help.');
  assert.equal(saved.replyAt, 25);
  assert.equal(saved.replyReadByUser, false, 'a newly sent admin reply is unread for the user');
  const { body: userSession } = await login('Alice', 'user-pass');
  const userRead = await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, userSession.sessionToken);
  const received = await userRead.json();
  assert.equal(received[0].replyReadByUser, false);
  received[0].replyReadByUser = true;
  const markRead = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: received }, userSession.sessionToken);
  assert.equal(markRead.status, 200);
  assert.equal(database.adminMessages['user-1'][0].replyReadByUser, true, 'the user can mark an existing reply as read');
  const adminRefresh = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: [
    { ...database.adminMessages['user-1'][0], replyReadByUser: false }
  ] }, body.sessionToken);
  assert.equal(adminRefresh.status, 200);
  assert.equal(database.adminMessages['user-1'][0].replyReadByUser, true, 'admin refresh cannot reset or forge user read state');
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('an arbitrary admin flag cannot elevate a non-TEMO account', async () => {
  database.users.push({ id: 'user-2', name: 'Bob', password: 'bob-pass', admin: true, authorized: true, blocked: false });
  const { response, body } = await login('Bob', 'bob-pass');
  assert.equal(response.status, 200);
  assert.equal(body.user.admin, false);
  assert.equal((await call({ action: 'db', path: 'adminMessages', method: 'GET' }, body.sessionToken)).status, 403);
});

test('blocked, removed, renamed, or password-changed accounts lose their active session', async () => {
  const blocked = await login('Alice', 'user-pass');
  database.users[0].blocked = true;
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, blocked.body.sessionToken)).status, 401);
  database.users[0].blocked = false;
  const changed = await login('Alice', 'user-pass');
  database.users[0].password = 'new-pass';
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, changed.body.sessionToken)).status, 401);
  const removed = await login('Alice', 'new-pass');
  database.users = database.users.filter(user => user.id !== 'user-1');
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, removed.body.sessionToken)).status, 401);
  database.users = structuredClone(originalUsers);
  const renamed = await login('Alice', 'user-pass');
  database.users[0].name = 'Alicia';
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, renamed.body.sessionToken)).status, 401);
});

test('sessions expire, signatures cannot be tampered with, and unauthenticated/unsafe paths are rejected', async () => {
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' })).status, 401);
  const { body } = await login('Alice', 'user-pass');
  const [payload, signature] = body.sessionToken.split('.');
  const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal((await call({ action: 'session' }, payload + '.' + changedSignature)).status, 401);
  const expiredClaims = { sub: 'user-1', name: 'Alice', admin: false, credential: 'not-current', exp: Math.floor(Date.now() / 1000) - 1 };
  const expiredPayload = Buffer.from(JSON.stringify(expiredClaims)).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expiredSignature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expiredPayload))).toString('base64url');
  assert.equal((await call({ action: 'session' }, expiredPayload + '.' + expiredSignature)).status, 401);
  assert.equal((await call({ action: 'db', path: 'users', method: 'GET' }, body.sessionToken)).status, 400);
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'DELETE' }, body.sessionToken)).status, 403);
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('wrong Origin and missing/weak session secret fail closed', async () => {
  const response = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'Alice', password: 'user-pass' }) }), env);
  assert.equal(response.status, 403);
  const weak = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://temo1.gr', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'Alice', password: 'user-pass' }) }), { ...env, SESSION_SECRET: 'short' });
  assert.equal(weak.status, 503);
});

test('deleteChatDialog sends only its thread deletion through the bridge', async () => {
  const fs = await import('node:fs/promises');
  const path = new URL('../../index.html', import.meta.url);
  const html = await fs.readFile(path, 'utf8');
  const deleteBlock = html.slice(html.indexOf('async function deleteChatDialog('), html.indexOf('async function replyToUser('));
  assert.ok(deleteBlock.includes("bridgeRequest('db',{path:'adminMessages/'+key,method:'DELETE'})"));
  assert.doesNotMatch(deleteBlock, /fetch\(FIREBASE_DB_URL/);
});

test('malformed and oversized requests fail before database access', async () => {
  const malformed = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://temo1.gr', 'Content-Type': 'application/json' }, body: '{bad json' }), env);
  assert.equal(malformed.status, 400);
  const oversized = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://temo1.gr', 'Content-Type': 'application/json', 'Content-Length': '1048577' }, body: '{}' }), env);
  assert.equal(oversized.status, 413);
  const method = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'GET', headers: { Origin: 'https://temo1.gr' } }), env);
  assert.equal(method.status, 405);
  const preflight = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'OPTIONS', headers: { Origin: 'https://temo1.gr' } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

test('Firebase Auth and Realtime Database failures return safe errors and never leak response bodies', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (new URL(String(input)).hostname === 'identitytoolkit.googleapis.com') return new Response('private auth detail', { status: 401 });
    return previousFetch(input);
  };
  const authFailure = await worker.fetch(new Request('https://temo1-firebase-bridge.test/', { method: 'POST', headers: { Origin: 'https://temo1.gr', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'Alice', password: 'user-pass' }) }), { ...env, FIREBASE_EMAIL: 'rotated@example.invalid' });
  assert.equal(authFailure.status, 503);
  assert.doesNotMatch(await authFailure.text(), /private auth detail/);
  globalThis.fetch = previousFetch;

  const { body } = await login('Alice', 'user-pass');
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'temo-75-default-rtdb.europe-west1.firebasedatabase.app' && url.pathname.includes('adminMessages')) return new Response('private database detail', { status: 500 });
    return previousFetch(input);
  };
  const dbFailure = await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(dbFailure.status, 502);
  assert.doesNotMatch(await dbFailure.text(), /private database detail/);
  globalThis.fetch = previousFetch;
});

test('emulator overrides isolate Auth, RTDB namespace, and allowed Origin from production', async () => {
  const isolated = { ...env, FIREBASE_EMAIL: 'emulator-service@example.invalid', FIREBASE_PASSWORD: 'emulator-only', FIREBASE_API_KEY: 'fake-api-key', FIREBASE_AUTH_URL: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', FIREBASE_DB_URL: 'http://127.0.0.1:9000', FIREBASE_DB_NAMESPACE: 'demo-temo1-bridge', ALLOWED_ORIGIN: 'http://localhost:5500' };
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    seen.push({ host: url.host, key: url.searchParams.get('key'), namespace: url.searchParams.get('ns'), auth: url.searchParams.get('auth'), method: init.method || 'GET' });
    if (url.host === '127.0.0.1:9099') return new Response(JSON.stringify({ idToken: 'emulator-id-token', expiresIn: '3600' }), { status: 200 });
    if (url.host === '127.0.0.1:9000' && url.searchParams.get('auth') === 'emulator-id-token' && url.searchParams.get('ns') === isolated.FIREBASE_DB_NAMESPACE) return new Response(JSON.stringify(originalUsers), { status: 200 });
    throw new Error('Unexpected non-emulator endpoint');
  };
  const response = await worker.fetch(new Request('http://127.0.0.1:8787/', { method: 'POST', headers: { Origin: isolated.ALLOWED_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', username: 'Alice', password: 'user-pass' }) }), isolated);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, 'user-1');
  assert.ok(seen.some(x => x.host === '127.0.0.1:9099' && x.key === 'fake-api-key'));
  assert.ok(seen.some(x => x.host === '127.0.0.1:9000' && x.namespace === 'demo-temo1-bridge' && x.auth === 'emulator-id-token'));
  assert.equal(seen.some(x => x.host === 'temo-75-default-rtdb.europe-west1.firebasedatabase.app'), false);
  globalThis.fetch = previousFetch;
});


test('expenses require a signed-in session and are limited to the caller\'s own path', async () => {
  const unauthorized = await call({ action: 'db', path: 'expenses/user-1', method: 'GET' });
  assert.equal(unauthorized.status, 401);

  const { body } = await login('Alice', 'user-pass');
  const ownRead = await call({ action: 'db', path: 'expenses/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(ownRead.status, 200);
  assert.equal((await ownRead.json())[0].amount, 12.5);

  const ownWrite = await call({ action: 'db', path: 'expenses/user-1', method: 'PUT', data: [
    { id: 'exp-2', category: '⛽ საწვავი', amount: 20, date: '2026-10-26', createdAt: 2 }
  ] }, body.sessionToken);
  assert.equal(ownWrite.status, 200);
  assert.equal(database.expenses['user-1'][0].amount, 20);

  assert.equal((await call({ action: 'db', path: 'expenses/admin-1', method: 'GET' }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'expenses/admin-1', method: 'PUT', data: [] }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'expenses/user-1/extra', method: 'GET' }, body.sessionToken)).status, 400);
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('jobs and deletion markers require a signed-in session and stay within the caller\'s user path', async () => {
  assert.equal((await call({ action: 'db', path: 'jobs/user-1', method: 'GET' })).status, 401);

  const { body } = await login('Alice', 'user-pass');
  const jobs = await call({ action: 'db', path: 'jobs/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(jobs.status, 200);
  assert.equal((await jobs.json())[0].id, 'job-1');

  const deletes = await call({ action: 'db', path: 'jobDeletes/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(deletes.status, 200);
  assert.deepEqual(await deletes.json(), { old: 2 });

  const savedJobs = await call({ action: 'db', path: 'jobs/user-1', method: 'PUT', data: [
    { id: 'job-1', date: '2026-10-01', place: 'local', money: 125, paid: true, updatedAt: 3 },
    { id: 'job-2', date: '2026-10-02', place: 'new browser', money: 50, paid: false, updatedAt: 4 }
  ] }, body.sessionToken);
  assert.equal(savedJobs.status, 200);
  assert.equal(database.jobs['user-1'].length, 2);
  assert.equal(database.jobs['user-1'][0].money, 125);

  const savedDeletes = await call({ action: 'db', path: 'jobDeletes/user-1', method: 'PUT', data: { old: 2, removed: 5 } }, body.sessionToken);
  assert.equal(savedDeletes.status, 200);
  assert.deepEqual(database.jobDeletes['user-1'], { old: 2, removed: 5 });

  assert.equal((await call({ action: 'db', path: 'jobs/admin-1', method: 'GET' }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'jobs/admin-1', method: 'PUT', data: [] }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'jobDeletes/admin-1', method: 'GET' }, body.sessionToken)).status, 403);
  assert.equal((await call({ action: 'db', path: 'jobDeletes/user-1/extra', method: 'GET' }, body.sessionToken)).status, 400);
  assert.deepEqual(database.users, originalUsersSnapshot);
});
