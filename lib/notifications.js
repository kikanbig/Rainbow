/**
 * Менеджер push-уведомлений
 * 
 * Хранит подписки пользователей (in-memory).
 * Каждые 10 минут проверяет условия радуги для каждого подписчика.
 * Если вероятность > 60% — отправляет push-уведомление.
 */

const webpush = require('web-push');
const { calculateRainbowProbability } = require('./rainbow-server');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:rainbow@example.com';
const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 минут
const PROBABILITY_THRESHOLD = 60;
const COOLDOWN_MS = 60 * 60 * 1000; // Не чаще 1 раза в час на пользователя

// Настройка web-push
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

/**
 * Хранилище подписок
 * Map<string, {subscription, lat, lon, lastNotified}>
 * Ключ — endpoint URL подписки
 */
const subscribers = new Map();

/**
 * Добавить/обновить подписку
 */
function addSubscription(subscription, lat, lon) {
  const key = subscription.endpoint;
  subscribers.set(key, {
    subscription,
    lat,
    lon,
    lastNotified: 0
  });
  console.log(`[Notifications] Подписка добавлена. Всего: ${subscribers.size}`);
  return true;
}

/**
 * Удалить подписку
 */
function removeSubscription(endpoint) {
  subscribers.delete(endpoint);
  console.log(`[Notifications] Подписка удалена. Всего: ${subscribers.size}`);
}

/**
 * Обновить координаты подписчика
 */
function updateLocation(endpoint, lat, lon) {
  const sub = subscribers.get(endpoint);
  if (sub) {
    sub.lat = lat;
    sub.lon = lon;
  }
}

/**
 * Получить текущую погоду для координат
 */
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

/**
 * Отправить push-уведомление
 */
async function sendPush(subscription, data) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(data));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Подписка истекла — удаляем
      removeSubscription(subscription.endpoint);
    }
    console.error('[Notifications] Ошибка отправки push:', err.statusCode || err.message);
    return false;
  }
}

/**
 * Основная проверка — вызывается каждые 10 минут
 */
async function checkAllSubscribers() {
  if (subscribers.size === 0) return;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[Notifications] VAPID ключи не настроены, пропускаем проверку');
    return;
  }

  console.log(`[Notifications] Проверка ${subscribers.size} подписчиков...`);
  const now = Date.now();

  for (const [key, sub] of subscribers) {
    // Проверяем cooldown
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
          console.log(`[Notifications] Уведомление отправлено: ${result.probability}% — ${result.direction}`);
        }
      }
    } catch (e) {
      console.error(`[Notifications] Ошибка проверки подписчика:`, e.message);
    }
  }
}

/**
 * Запуск периодической проверки
 */
let intervalId = null;

function startChecker() {
  if (intervalId) return;
  console.log(`[Notifications] Запуск проверки каждые ${CHECK_INTERVAL / 60000} мин (порог: ${PROBABILITY_THRESHOLD}%)`);
  intervalId = setInterval(checkAllSubscribers, CHECK_INTERVAL);
  // Первая проверка через 30 сек после старта
  setTimeout(checkAllSubscribers, 30000);
}

function stopChecker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function getStats() {
  return {
    subscribers: subscribers.size,
    checkIntervalMinutes: CHECK_INTERVAL / 60000,
    threshold: PROBABILITY_THRESHOLD
  };
}

module.exports = {
  addSubscription,
  removeSubscription,
  updateLocation,
  startChecker,
  stopChecker,
  getStats
};
