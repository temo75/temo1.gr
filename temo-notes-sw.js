self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    if (self.registration.getNotifications) {
      const previous = await self.registration.getNotifications();
      previous
        .filter(notification => String(notification.tag || '').startsWith('temo-video-call'))
        .forEach(notification => notification.close());
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil((async () => {
    const scopeUrl = new URL(self.registration.scope);
    let targetUrl;
    try {
      targetUrl = new URL(event.notification.data || './', scopeUrl);
    } catch (e) {
      targetUrl = scopeUrl;
    }
    if (targetUrl.origin !== scopeUrl.origin || !targetUrl.pathname.startsWith(scopeUrl.pathname)) {
      targetUrl = scopeUrl;
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find(candidate => {
      try {
        const url = new URL(candidate.url);
        return url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
      } catch (e) {
        return false;
      }
    });

    if (client) {
      if (client.url !== targetUrl.href && 'navigate' in client) {
        try {
          await client.navigate(targetUrl.href);
          return client.focus();
        } catch (e) {
          return self.clients.openWindow(targetUrl.href);
        }
      }
      return client.focus();
    }

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

  const isVideoCall = String(data.tag || '').startsWith('temo-video-call');
  const notificationTag = isVideoCall ? 'temo-video-call' : (data.tag || 'temo-note-reminder');

  const options = {
    body: data.body || 'შეხსენების დრო მოვიდა',
    icon: data.icon || './icon.png',
    image: data.image || './notification-banner.jpg',
    badge: data.badge || './badge.png',
    tag: notificationTag,
    requireInteraction: data.requireInteraction !== false,
    renotify: isVideoCall ? true : data.renotify !== false,
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : undefined,
    data: data.url || './'
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
  })());
});
