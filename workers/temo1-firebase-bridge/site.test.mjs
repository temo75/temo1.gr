import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let html;
test.before(async () => { html = await readFile(resolve(root, 'index.html'), 'utf8'); });
test('site login and session restoration use the signed bridge session', () => {
  assert.match(html, /https:\/\/temo1-firebase-bridge\.temo75elia\.workers\.dev/);
  assert.match(html, /location\.hostname==='localhost'/);
  assert.match(html, /http:\/\/127\.0\.0\.1:8787/);
  assert.match(html, /bridgeRequest\('login',\{username:name,password:pass\},''\)/);
  assert.match(html, /bridgeRequest\('session',\{\},savedBridgeToken\)/);
  assert.match(html, /localStorage\.setItem\(BRIDGE_SESSION_KEY,sessionToken\)/);
  assert.match(html, /localStorage\.removeItem\(BRIDGE_SESSION_KEY\)/);
});
test('message reads, writes, inbox view, and admin replies use the bridge', () => {
  const load = html.slice(html.indexOf('async function loadChatThread('), html.indexOf('async function saveChatThread('));
  const save = html.slice(html.indexOf('async function saveChatThread('), html.indexOf('function updateUserChatCount('));
  const inbox = html.slice(html.indexOf('async function loadAllAdminChats('), html.indexOf('async function renderAdminMessages('));
  const reply = html.slice(html.indexOf('async function replyToUser('), html.indexOf('let managedUsersRenderKey='));
  assert.ok(load.includes("bridgeRequest('db',{path:'adminMessages/'+key,method:'GET'})"));
  assert.ok(save.includes("bridgeRequest('db',{path:'adminMessages/'+key,method:'PUT',data:thread})"));
  assert.match(inbox, /bridgeRequest\('db',\{path:'adminMessages',method:'GET'\}\)/);
  assert.match(reply, /await saveChatThread\(userId,thread\)/);
  assert.doesNotMatch(load + save + inbox, /fetch\(FIREBASE_DB_URL/);
});
test('the login handler no longer reads users directly from unauthenticated Firebase REST', () => {
  const login = html.slice(html.indexOf('async function login()'), html.indexOf('function renderLoginUsers()'));
  assert.doesNotMatch(login, /loadUsersFromFirebase|FIREBASE_DB_URL/);
  assert.match(html, /response\.status===401&&action!=='login'&&token\)expireBridgeSession\(\)/);
  assert.match(html, /function expireBridgeSession\(\).*removeItem\(BRIDGE_SESSION_KEY\).*currentUser='';currentUserId=''/);
});


test('expense reads and writes use the authenticated bridge and render the home total', () => {
  const save = html.slice(html.indexOf('async function saveExpensesToFirebase('), html.indexOf('async function syncExpensesFromFirebase('));
  const load = html.slice(html.indexOf('async function syncExpensesFromFirebase('), html.indexOf('function expenseCategoryParts('));
  const render = html.slice(html.indexOf('function renderExpenses('), html.indexOf('function closeExpenseDayPopup('));
  assert.match(save, /bridgeRequest\('db',\{path,method:'PUT',data:expenses\}\)/);
  assert.match(load, /bridgeRequest\('db',\{path,method:'GET'\}\)/);
  assert.doesNotMatch(save + load, /fetch\(FIREBASE_DB_URL/);
  assert.match(render, /expenseMonthTotalMain/);
  assert.match(html, /syncExpensesFromFirebase\(\);/);
});

test('job records and deletion markers synchronize only through the authenticated bridge', () => {
  const load = html.slice(html.indexOf('async function loadJobsFromFirebase('), html.indexOf('async function saveJobsToFirebase('));
  const save = html.slice(html.indexOf('async function saveJobsToFirebase('), html.indexOf('async function syncJobsFromFirebase('));
  const receivable = html.slice(html.indexOf('async function saveReceivablePaidToFirebase('), html.indexOf('function setReceivablePaid('));
  assert.ok(load.includes("jobsPromise=bridgeRequest('db',{path:'jobs/'+key,method:'GET'})"));
  assert.ok(load.includes("bridgeRequest('db',{path:'jobDeletes/'+key,method:'GET'})"));
  assert.match(save, /bridgeRequest\('db',\{path,method:'PUT',data\}\)/);
  assert.match(save, /bridgeRequest\('db',\{path:deletePath,method:'PUT',data:merged\.deletes\}\)/);
  assert.match(receivable, /bridgeRequest\('db',\{path:'jobs\/'+firebaseUserKey\(id\),method:'PUT',data\}\)/);
  assert.doesNotMatch(load + save + receivable, /fetch\(FIREBASE_DB_URL/);
  assert.match(save, /if\(remoteState===null\)return false/);
});

test('cross-browser job merge keeps unique records and applies deletion timestamps', () => {
  const start = html.indexOf('const JOB_DELETES_KEY=');
  const end = html.indexOf('async function loadJobsFromFirebase(', start);
  const helpers = html.slice(start, end);
  const mergeJobSyncState = new Function(helpers + '; return mergeJobSyncState;')();
  const merged = mergeJobSyncState(
    [
      { id: 'local-only', date: '2026-10-02', money: 20, updatedAt: 3 },
      { id: 'shared', date: '2026-10-01', money: 12, updatedAt: 10 }
    ],
    [
      { id: 'remote-only', date: '2026-10-03', money: 30, updatedAt: 4 },
      { id: 'shared', date: '2026-10-01', money: 10, updatedAt: 5 },
      { id: 'removed', date: '2026-10-04', money: 40, updatedAt: 1 }
    ],
    {},
    { removed: 2 }
  );
  assert.deepEqual(merged.jobs.map(job => job.id), ['local-only', 'remote-only', 'shared']);
  assert.equal(merged.jobs.find(job => job.id === 'shared').money, 12);
  assert.deepEqual(merged.deletes, { removed: 2 });
});
