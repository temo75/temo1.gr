self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', event => {
  const notificationData = event.notification.data || {};
  const isChat = String(event.notification.tag || '').startsWith('temo-chat-');
  event.notification.close();
  event.waitUntil((async () => {
    const scopeUrl = new URL(self.registration.scope);
    let targetUrl;
    if (isChat) targetUrl = new URL('messenger.html', scopeUrl);
    else {
      try { targetUrl = new URL(typeof notificationData === 'string' ? notificationData : (notificationData.url || './'), scopeUrl); }
      catch (e) { targetUrl = scopeUrl; }
    }
    if (targetUrl.origin !== scopeUrl.origin || !targetUrl.pathname.startsWith(scopeUrl.pathname)) targetUrl = scopeUrl;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exactClient = windows.find(client => {
      try { const url = new URL(client.url); return url.origin === targetUrl.origin && url.pathname === targetUrl.pathname; }
      catch (e) { return false; }
    });
    if (exactClient) return exactClient.focus();
    // Keep the old home page open; open Messenger in its own window.
    return self.clients.openWindow(targetUrl.href);
  })());
});

self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: '\u200B',
      body: event.data ? event.data.text() : 'ახალი შეხსენება'
    };
  }

  const title = typeof data.title === 'string' && data.title.length > 0 ? data.title : '\u200B';

  const options = {
    body: data.body || 'შეხსენების დრო მოვიდა',
    icon: data.icon || './icon.png',
    image: data.image || './notification-banner.jpg',
    badge: data.badge || './badge.png',
    tag: data.tag || 'temo-note-reminder',
    requireInteraction: true,
    renotify: true,
    data: data.url || './'
  };

  event.waitUntil((async () => {
    // Always display incoming Push notifications, even while TEMO is open.
    const isChat = String(data.tag || '').startsWith('temo-chat-');
    const options = {
      ...options,
      tag: data.tag || 'temo-note-reminder',
      renotify: isChat ? false : Boolean(data.renotify),
      requireInteraction: isChat ? false : options.requireInteraction
    };
    try {
      await self.registration.showNotification(title, options);
    } catch (displayError) {
      // Some browsers reject optional image/badge/interaction options.
      // Retry with the cross-browser minimum so a valid Push is still shown.
      await self.registration.showNotification(title, {
        body: String(data.body || 'ახალი შეტყობინება'),
        tag: String(data.tag || 'temo-note-reminder'),
        data: { url: typeof data.url === 'string' ? data.url : './' }
      });
    }
  })());
});
