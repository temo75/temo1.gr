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
  database = { users: structuredClone(originalUsers), adminMessages: { 'user-1': [{ id: 'msg-1', userId: 'user-1', userName: 'Alice', text: 'Hello', createdAt: 10, reply: '', replyAt: 0, readByAdmin: false, replyReadByUser: true }] } };
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

test('user and admin credentials create scoped sessions without returning passwords', async () => {
  const user = await login('Alice', 'user-pass');
  const admin = await login('TEMO', 'admin-pass');
  assert.equal(user.response.status, 200);
  assert.equal(user.body.user.admin, false);
  assert.equal(user.body.user.password, undefined);
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.user.admin, true);
  assert.equal((await login('Alice', 'wrong')).response.status, 401);
});

test('user can read and send own messages but cannot access another thread or admin inbox', async () => {
  const { body } = await login('Alice', 'user-pass');
  const read = await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, body.sessionToken);
  assert.equal(read.status, 200);
  assert.equal((await read.json())[0].text, 'Hello');
  const deniedThread = await call({ action: 'db', path: 'adminMessages/admin-1', method: 'GET' }, body.sessionToken);
  const deniedInbox = await call({ action: 'db', path: 'adminMessages', method: 'GET' }, body.sessionToken);
  assert.equal(deniedThread.status, 403);
  assert.equal(deniedInbox.status, 403);
  const write = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: [
    { id: 'msg-1', userId: 'admin-1', userName: 'Fake', text: 'Hello', reply: 'forged admin reply', replyAt: 20, createdAt: 10 },
    { id: 'msg-2', text: 'New question', reply: 'forged', replyAt: 30, createdAt: 40 }
  ] }, body.sessionToken);
  assert.equal(write.status, 200);
  assert.equal(database.adminMessages['user-1'][0].userId, 'user-1');
  assert.equal(database.adminMessages['user-1'][0].reply, '');
  assert.equal(database.adminMessages['user-1'][1].reply, '');
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('admin can read inbox and reply without changing the user message or user account data', async () => {
  const { body } = await login('TEMO', 'admin-pass');
  const inbox = await call({ action: 'db', path: 'adminMessages', method: 'GET' }, body.sessionToken);
  assert.equal(inbox.status, 200);
  const write = await call({ action: 'db', path: 'adminMessages/user-1', method: 'PUT', data: [
    { ...database.adminMessages['user-1'][0], text: 'tampered', userName: 'tampered', reply: 'We will help.', replyAt: 25, readByAdmin: true }
  ] }, body.sessionToken);
  assert.equal(write.status, 200);
  const saved = database.adminMessages['user-1'][0];
  assert.equal(saved.text, 'Hello');
  assert.equal(saved.userName, 'Alice');
  assert.equal(saved.reply, 'We will help.');
  assert.equal(saved.replyAt, 25);
  assert.deepEqual(database.users, originalUsersSnapshot);
});

test('missing or forged sessions are denied and unsafe paths/methods are rejected', async () => {
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' })).status, 401);
  const { body } = await login('Alice', 'user-pass');
  assert.equal((await call({ action: 'db', path: 'users', method: 'GET' }, body.sessionToken)).status, 400);
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'DELETE' }, body.sessionToken)).status, 400);
  assert.equal((await call({ action: 'db', path: 'adminMessages/user-1', method: 'GET' }, 'forged.token')).status, 401);
});
