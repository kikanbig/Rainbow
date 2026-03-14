/**
 * Менеджер push-уведомлений
 * 
 * Хранит подписки пользователей с персистентным хранением в JSON-файле.
 * Каждые 10 минут проверяет условия радуги для каждого подписчика.
 * Если вероятность > 80% — отправляет push-уведомление.
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { calculateRainbowProbability } = require('./rainbow-server');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:rainbow@example.com';
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 минут
const PROBABILITY_THRESHOLD = 80;
const COOLDOWN_MS = 60 * 60 * 1000; // Не чаще 1 раза в час на пользователя

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

/**
 * Хранилище подписок
 * Map<string, {subscription, lat, lon, lastNotified}>
 */
const subscribers = new Map();

// ═══ Персистентное хранение ═══

function loadSubscriptions() {
  try {
    if (!fs.existsSync(SUBS_FILE)) return;
    const raw = fs.readFileSync(SUBS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    for (const item of arr) {
      if (item.subscription && item.subscription.endpoint) {
        subscribers.set(item.subscription.endpoint, {
          subscription: item.subscription,
          lat: item.lat || 0,
          lon: item.lon || 0,
          lastNotified: item.lastNotified || 0
        });
      }
    }
    console.log(`[Notifications] Загружено ${subscribers.size} подписок из файла`);
  } catch (e) {
    console.warn('[Notifications] Не удалось загрузить подписки:', e.message);
  }
}

function saveSubscriptions() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const arr = [];
    for (const [key, sub] of subscribers) {
      arr.push({
        subscription: sub.subscription,
        lat: sub.lat,
        lon: sub.lon,
        lastNotified: sub.lastNotified
      });
    }
    fs.writeFileSync(SUBS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Notifications] Не удалось сохранить подписки:', e.message);
  }
}

// Загружаем при старте модуля
loadSubscriptions();

// ═══ Управление подписками ═══

function addSubscription(subscription, lat, lon) {
  const key = subscription.endpoint;
  subscribers.set(key, {
    subscription,
    lat,
    lon,
    lastNotified: 0
  });
  saveSubscriptions();
  console.log(`[Notifications] ✅ Подписка добавлена (lat: ${lat.toFixed(2)}, lon: ${lon.toFixed(2)}). Всего: ${subscribers.size}`);
  return true;
}

function removeSubscription(endpoint) {
  subscribers.delete(endpoint);
  saveSubscriptions();
  console.log(`[Notifications] Подписка удалена. Всего: ${subscribers.size}`);
}

/**
 * @returns {boolean} true если подписка найдена
 */
function updateLocation(endpoint, lat, lon) {
  const sub = subscribers.get(endpoint);
  if (sub) {
    sub.lat = lat;
    sub.lon = lon;
    saveSubscriptions();
    return true;
  }
  return false;
}

// ═══ Погода и push ═══

async function fetchWeather(lat, lon) {
  if (!WEATHER_API_KEY) return null;
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[Notifications] Ошибка получения погоды:', e.message);
    return null;
  }
}

async function sendPush(subscription, data) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(data));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      removeSubscription(subscription.endpoint);
    }
    console.error('[Notifications] Ошибка отправки push:', err.statusCode || err.message);
    return false;
  }
}

// ═══ Периодическая проверка ═══

async function checkAllSubscribers() {
  if (subscribers.size === 0) return;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[Notifications] VAPID ключи не настроены');
    return;
  }

  console.log(`[Notifications] Проверка ${subscribers.size} подписчиков...`);
  const now = Date.now();

  for (const [key, sub] of subscribers) {
    if (now - sub.lastNotified < COOLDOWN_MS) continue;

    try {
      const weather = await fetchWeather(sub.lat, sub.lon);
      if (!weather) continue;

      const result = calculateRainbowProbability(weather, sub.lat, sub.lon);

      if (result.probability >= PROBABILITY_THRESHOLD) {
        const sent = await sendPush(sub.subscription, {
          title: `🌈 Радуга! ${result.probability}%`,
          body: result.message,
          data: {
            probability: result.probability,
            direction: result.direction,
            azimuth: result.azimuth
          }
        });

        if (sent) {
          sub.lastNotified = now;
          saveSubscriptions();
          console.log(`[Notifications] Уведомление отправлено: ${result.probability}%`);
        }
      }
    } catch (e) {
      console.error(`[Notifications] Ошибка проверки:`, e.message);
    }
  }
}

let intervalId = null;

function startChecker() {
  if (intervalId) return;
  console.log(`[Notifications] Запуск проверки каждые ${CHECK_INTERVAL / 60000} мин (порог: ${PROBABILITY_THRESHOLD}%)`);
  intervalId = setInterval(checkAllSubscribers, CHECK_INTERVAL);
  setTimeout(checkAllSubscribers, 30000);
}

function stopChecker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function getSubscriberCount() {
  return subscribers.size;
}

async function broadcastNotification(title, body) {
  if (subscribers.size === 0) {
    return { total: 0, sent: 0 };
  }

  let sent = 0;
  const total = subscribers.size;

  for (const [key, sub] of subscribers) {
    try {
      const success = await sendPush(sub.subscription, { title, body });
      if (success) sent++;
    } catch (e) {
      console.error(`[Notifications] Ошибка broadcast:`, e.message);
    }
  }

  console.log(`[Notifications] Broadcast: ${sent}/${total}`);
  return { total, sent };
}

module.exports = {
  addSubscription,
  removeSubscription,
  updateLocation,
  startChecker,
  stopChecker,
  getSubscriberCount,
  broadcastNotification
};
