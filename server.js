require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const notifications = require('./lib/notifications');

const app = express();
const PORT = process.env.PORT || 3000;
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';

// ═══ Версия билда (хеш ключевых файлов) ═══
function computeBuildVersion() {
  const files = [
    'server.js',
    'public/index.html',
    'public/js/app.js',
    'public/js/compass.js',
    'public/js/rainbow.js',
    'public/js/suncalc.js',
    'public/js/weather.js',
    'public/css/style.css',
    'public/sw.js'
  ];
  const hash = crypto.createHash('md5');
  for (const f of files) {
    try { hash.update(fs.readFileSync(path.join(__dirname, f))); } catch(e) {}
  }
  return hash.digest('hex').slice(0, 12);
}
const BUILD_VERSION = computeBuildVersion();
console.log(`Build version: ${BUILD_VERSION}`);

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders(res, filePath) {
    // Все ключевые ресурсы — без кэша, чтобы обновления приходили мгновенно
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

// ═══ Версия приложения ═══
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.json({ version: BUILD_VERSION });
});

// ═══ VAPID public key (клиент запрашивает для подписки) ═══
app.get('/api/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Server] VAPID ключи не настроены!');
    return res.status(503).json({ error: 'Push-уведомления не настроены' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ═══ Статус уведомлений (для отладки) ═══
app.get('/api/push/stats', (req, res) => {
  const stats = notifications.getStats();
  res.json({
    ...stats,
    vapidConfigured: !!(VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  });
});

// ═══ Подписка на push-уведомления ═══
app.post('/api/push/subscribe', (req, res) => {
  const { subscription, lat, lon } = req.body;
  if (!subscription || !subscription.endpoint || lat == null || lon == null) {
    return res.status(400).json({ error: 'Нужны subscription, lat, lon' });
  }
  notifications.addSubscription(subscription, lat, lon);
  res.json({ success: true });
});

// ═══ Отписка от push-уведомлений ═══
app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Нужен endpoint' });
  }
  notifications.removeSubscription(endpoint);
  res.json({ success: true });
});

// ═══ Обновить координаты подписчика ═══
app.post('/api/push/update-location', (req, res) => {
  const { endpoint, lat, lon } = req.body;
  if (!endpoint || lat == null || lon == null) {
    return res.status(400).json({ error: 'Нужны endpoint, lat, lon' });
  }
  notifications.updateLocation(endpoint, lat, lon);
  res.json({ success: true });
});

// ═══ ТЕСТОВЫЙ endpoint — отправить уведомление всем (для проверки) ═══
app.post('/api/push/test', async (req, res) => {
  const result = await notifications.sendTestNotification();
  res.json(result);
});

// ═══ Proxy: текущая погода ═══
app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Параметры lat и lon обязательны' });
  }
  if (!WEATHER_API_KEY) {
    return res.status(503).json({ error: 'API ключ не настроен' });
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Weather API error:', err);
    res.status(500).json({ error: 'Ошибка получения данных о погоде' });
  }
});

// ═══ Proxy: прогноз ═══
app.get('/api/forecast', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Параметры lat и lon обязательны' });
  }
  if (!WEATHER_API_KEY) {
    return res.status(503).json({ error: 'API ключ не настроен' });
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru&cnt=8`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Forecast API error:', err);
    res.status(500).json({ error: 'Ошибка получения прогноза' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌈 Rainbow Finder запущен на порту ${PORT}`);
  // Запуск периодической проверки уведомлений
  notifications.startChecker();
});
