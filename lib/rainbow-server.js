/**
 * Серверный модуль расчёта вероятности радуги (CommonJS)
 */

const { getSunPosition } = require('./suncalc-server');

function isRaining(weatherId) {
  return weatherId >= 200 && weatherId < 600;
}

function getPrecipType(weatherId) {
  if (weatherId >= 200 && weatherId < 300) return 'thunderstorm';
  if (weatherId >= 300 && weatherId < 400) return 'drizzle';
  if (weatherId >= 500 && weatherId < 600) return 'rain';
  if (weatherId >= 600 && weatherId < 700) return 'snow';
  return 'none';
}

function getDirectionName(azimuth) {
  const dirs = ['Север', 'Северо-восток', 'Восток', 'Юго-восток', 'Юг', 'Юго-запад', 'Запад', 'Северо-запад'];
  return dirs[Math.round(azimuth / 45) % 8];
}

/**
 * Рассчитывает вероятность радуги на сервере
 * @param {Object} weather - ответ OpenWeatherMap API
 * @param {number} lat
 * @param {number} lon
 * @returns {{probability: number, direction: string, message: string}}
 */
function calculateRainbowProbability(weather, lat, lon) {
  const now = new Date();
  const sunPos = getSunPosition(now, lat, lon);

  const weatherId = weather.weather?.[0]?.id || 0;
  const humidity = weather.main?.humidity || 0;
  const clouds = weather.clouds?.all || 0;
  const visibility = weather.visibility || 10000;
  const rainAmount = weather.rain?.['1h'] || 0;
  const raining = isRaining(weatherId);
  const precipType = getPrecipType(weatherId);
  const alt = sunPos.altitude;

  let probability = 0;

  // Фактор 1: Осадки (макс 40)
  if (raining) {
    if (precipType === 'rain') {
      if (weatherId >= 520 && weatherId <= 531) probability += 40;
      else if (rainAmount > 2) probability += 35;
      else probability += 30;
    } else if (precipType === 'drizzle') probability += 25;
    else if (precipType === 'thunderstorm') probability += 30;
    else if (precipType === 'snow') probability += 2;
  } else if (humidity > 85) {
    probability += 8;
  }

  // Фактор 2: Солнце (макс 30)
  if (alt > 0 && alt < 42) {
    if (alt <= 5) probability += 30;
    else if (alt <= 15) probability += 28;
    else if (alt <= 25) probability += 24;
    else if (alt <= 35) probability += 18;
    else probability += 12;
  }

  // Фактор 3: Облачность (макс 15)
  if (clouds >= 20 && clouds <= 70) probability += 15;
  else if (clouds < 20) probability += (raining ? 12 : 5);
  else if (clouds <= 85) probability += 8;
  else probability += 2;

  // Фактор 4: Влажность + видимость (макс 15)
  if (humidity >= 60 && humidity <= 95) probability += 8;
  else if (humidity > 95) probability += 4;
  else if (humidity >= 40) probability += 3;
  if (visibility >= 5000) probability += 7;
  else if (visibility >= 3000) probability += 4;
  else probability += 1;

  probability = Math.min(95, Math.max(0, Math.round(probability)));

  // Направление
  const antiSolarAz = (sunPos.azimuth + 180) % 360;
  const direction = alt > 0 ? getDirectionName(antiSolarAz) : null;

  let message;
  if (alt <= 0) {
    message = 'Солнце за горизонтом — радуга невозможна.';
  } else if (probability >= 70) {
    message = `Отличные условия! Смотрите на ${direction} (${antiSolarAz.toFixed(0)}°)`;
  } else if (probability >= 40) {
    message = `Возможна радуга на ${direction}. Следите за просветами в облаках.`;
  } else {
    message = 'Условия неидеальны для радуги.';
  }

  return {
    probability,
    direction,
    azimuth: antiSolarAz,
    sunAltitude: alt,
    message,
    weatherDescription: weather.weather?.[0]?.description || '',
    temp: weather.main?.temp
  };
}

module.exports = { calculateRainbowProbability };
