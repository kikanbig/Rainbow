/**
 * Модуль работы с API погоды
 * Проксируется через наш сервер для защиты API-ключа
 */

/**
 * Получает текущую погоду
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<Object>} данные о текущей погоде
 */
export async function fetchWeather(lat, lon) {
  const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Получает прогноз на ближайшие 24 часа
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<Object>} данные прогноза
 */
export async function fetchForecast(lat, lon) {
  const res = await fetch(`/api/forecast?lat=${lat}&lon=${lon}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Извлекает ключевые метеопараметры из ответа API
 * @param {Object} weather - ответ API текущей погоды
 * @returns {Object} нормализованные параметры
 */
export function parseWeatherData(weather) {
  if (!weather || !weather.weather) return null;
  
  const main = weather.main || {};
  const wind = weather.wind || {};
  const clouds = weather.clouds || {};
  const rain = weather.rain || {};
  const sys = weather.sys || {};
  const weatherInfo = weather.weather[0] || {};
  
  return {
    // Основные параметры
    temp: main.temp,
    feelsLike: main.feels_like,
    humidity: main.humidity,
    pressure: main.pressure,
    
    // Ветер
    windSpeed: wind.speed,
    windDeg: wind.deg,
    
    // Облачность (0-100%)
    cloudCover: clouds.all || 0,
    
    // Осадки за последний час (мм)
    rainLastHour: rain['1h'] || 0,
    rainLast3Hours: rain['3h'] || 0,
    
    // Код погоды OpenWeatherMap
    weatherId: weatherInfo.id,
    weatherMain: weatherInfo.main,
    weatherDescription: weatherInfo.description,
    weatherIcon: weatherInfo.icon,
    
    // Видимость (метры)
    visibility: weather.visibility || 10000,
    
    // Восход/закат (unix timestamp)
    sunrise: sys.sunrise ? new Date(sys.sunrise * 1000) : null,
    sunset: sys.sunset ? new Date(sys.sunset * 1000) : null,
    
    // Название города
    cityName: weather.name || '',
    
    // Координаты
    lat: weather.coord?.lat,
    lon: weather.coord?.lon
  };
}

/**
 * Анализирует прогноз на наличие осадков в ближайшие часы
 * @param {Object} forecast - ответ API прогноза
 * @returns {Object} анализ осадков
 */
export function analyzeForecast(forecast) {
  if (!forecast || !forecast.list) {
    return { hasUpcomingRain: false, hasRecentRain: false, rainPeriods: [] };
  }
  
  const now = Date.now();
  const rainPeriods = [];
  let hasUpcomingRain = false;
  let hasRecentRain = false;
  let nearestRainHours = Infinity;
  
  for (const item of forecast.list) {
    const time = item.dt * 1000;
    const hoursFromNow = (time - now) / (1000 * 60 * 60);
    const weatherId = item.weather?.[0]?.id || 0;
    const isRain = (weatherId >= 200 && weatherId < 600); // Дождь, гроза, морось
    
    if (isRain) {
      rainPeriods.push({
        time: new Date(time),
        hoursFromNow,
        description: item.weather[0].description,
        intensity: item.rain?.['3h'] || item.snow?.['3h'] || 0
      });
      
      if (hoursFromNow > 0 && hoursFromNow < 6) {
        hasUpcomingRain = true;
        nearestRainHours = Math.min(nearestRainHours, hoursFromNow);
      }
      if (hoursFromNow >= -3 && hoursFromNow <= 0) {
        hasRecentRain = true;
      }
    }
  }
  
  return {
    hasUpcomingRain,
    hasRecentRain,
    nearestRainHours: nearestRainHours === Infinity ? null : nearestRainHours,
    rainPeriods
  };
}

/**
 * Проверяет, идёт ли сейчас дождь по коду погоды
 */
export function isCurrentlyRaining(weatherId) {
  if (!weatherId) return false;
  // 2xx - гроза, 3xx - морось, 5xx - дождь
  return (weatherId >= 200 && weatherId < 600);
}

/**
 * Определяет тип осадков
 */
export function getPrecipitationType(weatherId) {
  if (!weatherId) return 'none';
  if (weatherId >= 200 && weatherId < 300) return 'thunderstorm';
  if (weatherId >= 300 && weatherId < 400) return 'drizzle';
  if (weatherId >= 500 && weatherId < 600) return 'rain';
  if (weatherId >= 600 && weatherId < 700) return 'snow';
  return 'none';
}
