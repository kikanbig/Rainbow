const CACHE_NAME = 'rainbow-finder-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css?v=12',
  '/js/app.js?v=12',
  '/js/suncalc.js?v=12',
  '/js/weather.js?v=12',
  '/js/rainbow.js?v=12',
  '/js/compass.js?v=12',
  '/manifest.json',
  '/icons/icon.svg'
];

// ═══ УСТАНОВКА ═══
// Принудительно активируем новый SW сразу (skipWaiting),
// чтобы обновления доходили до пользователя без задержки.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// ═══ АКТИВАЦИЯ ═══
// Удаляем старые кэши, берём контроль над клиентами.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ═══ СООБЩЕНИЯ ОТ КЛИЕНТА ═══
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══ FETCH ═══
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API, version — только сеть
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Статика — Network first, fallback cache (быстрее подхватывает обновления)
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ═══ PUSH-УВЕДОМЛЕНИЯ ═══

// Получение push-уведомления от сервера
self.addEventListener('push', (event) => {
  console.log('[SW] 🔔 Push event received!', event);
  
  let data = { title: 'Rainbow Finder', body: 'Проверьте условия радуги!' };
  
  try {
    if (event.data) {
      data = event.data.json();
      console.log('[SW] Push data:', data);
    }
  } catch (e) {
    console.warn('[SW] Push data parse error:', e);
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'rainbow-alert',
    renotify: true,
    requireInteraction: false, // Изменено: Android может блокировать requireInteraction
    data: data.data || {},
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' }
    ]
  };

  console.log('[SW] Showing notification:', data.title, options);

  event.waitUntil(
    self.registration.showNotification(data.title || 'Rainbow Finder', options)
      .then(() => console.log('[SW] ✅ Notification shown successfully'))
      .catch(err => console.error('[SW] ❌ Notification error:', err))
  );
});

// Клик по уведомлению — открыть приложение
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Если приложение уже открыто — фокусируемся на нём
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Иначе открываем новое окно
      return clients.openWindow('/');
    })
  );
});
