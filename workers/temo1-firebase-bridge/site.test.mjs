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

