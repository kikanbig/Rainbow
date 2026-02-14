/**
 * Модуль расчёта вероятности и направления радуги
 * 
 * НАУЧНАЯ БАЗА:
 * 
 * 1. ОПТИКА РАДУГИ:
 *    - Первичная радуга: свет преломляется в каплях воды и отражается 1 раз
 *    - Угол отклонения: ~42° от антисолнечной точки (точка на небе, 
 *      противоположная Солнцу относительно наблюдателя)
 *    - Вторичная радуга: двойное отражение, ~51° от антисолнечной точки
 *    - Цвета: красный снаружи (42°), фиолетовый внутри (40°)
 * 
 * 2. УСЛОВИЯ ВИДИМОСТИ:
 *    - Капли воды в воздухе перед наблюдателем (дождь, морось, туман, водопад)
 *    - Солнце за спиной наблюдателя
 *    - Солнце должно быть ниже 42° над горизонтом
 *    - Идеально: Солнце < 30° над горизонтом (радуга выше над горизонтом)
 *    - Лучшее время: утро (радуга на западе) или вечер (радуга на востоке)
 * 
 * 3. МЕТЕОУСЛОВИЯ:
 *    - Идеально: ливневый дождь с просветами (shower rain)
 *    - Хорошо: дождь при частичной облачности
 *    - Возможно: после дождя при высокой влажности
 *    - Плохо: сплошная облачность (солнце не видно), ночь, снег
 * 
 * 4. НАПРАВЛЕНИЕ:
 *    - Центр радуги = антисолнечная точка
 *    - Наблюдатель должен стоять спиной к Солнцу
 *    - Утром: смотреть на запад
 *    - Вечером: смотреть на восток
 */

import { getAntiSolarAzimuth, canRainbowBeVisible, isSunUp } from './suncalc.js';
import { isCurrentlyRaining, getPrecipitationType } from './weather.js';

/**
 * Основная функция расчёта вероятности радуги
 * 
 * @param {Object} weatherData - нормализованные данные погоды
 * @param {Object} forecastData - анализ прогноза
 * @param {Object} sunPosition - {azimuth, altitude}
 * @returns {Object} результат анализа
 */
export function analyzeRainbowConditions(weatherData, forecastData, sunPosition) {
  if (!weatherData || !sunPosition) {
    return {
      probability: 0,
      direction: null,
      factors: [],
      status: 'no_data',
      message: 'Нет данных для анализа'
    };
  }

  const factors = [];
  let probability = 0;
  
  // ═══════════════════════════════════════════
  // ФАКТОР 1: ОСАДКИ (макс. 40 баллов)
  // Самый важный фактор — наличие капель воды
  // ═══════════════════════════════════════════
  const raining = isCurrentlyRaining(weatherData.weatherId);
  const precipType = getPrecipitationType(weatherData.weatherId);
  
  if (raining) {
    if (precipType === 'rain') {
      // Ливневый дождь (52x) — идеально для радуги
      if (weatherData.weatherId >= 520 && weatherData.weatherId <= 531) {
        probability += 40;
        factors.push({ name: 'Ливневый дождь', score: 40, max: 40, icon: 'shower' });
      }
      // Обычный дождь
      else if (weatherData.rainLastHour > 2) {
        probability += 35;
        factors.push({ name: 'Сильный дождь', score: 35, max: 40, icon: 'rain' });
      } else {
        probability += 30;
        factors.push({ name: 'Дождь', score: 30, max: 40, icon: 'rain' });
      }
    } else if (precipType === 'drizzle') {
      probability += 25;
      factors.push({ name: 'Морось', score: 25, max: 40, icon: 'drizzle' });
    } else if (precipType === 'thunderstorm') {
      probability += 30;
      factors.push({ name: 'Гроза с дождём', score: 30, max: 40, icon: 'thunder' });
    } else if (precipType === 'snow') {
      probability += 2;
      factors.push({ name: 'Снег (неблагоприятно)', score: 2, max: 40, icon: 'snow' });
    }
  } else if (forecastData?.hasRecentRain) {
    probability += 20;
    factors.push({ name: 'Недавний дождь', score: 20, max: 40, icon: 'recent_rain' });
  } else if (forecastData?.hasUpcomingRain) {
    const nearHours = forecastData.nearestRainHours;
    const score = nearHours < 1 ? 15 : nearHours < 3 ? 10 : 5;
    probability += score;
    factors.push({ name: `Дождь через ${Math.round(nearHours)}ч`, score, max: 40, icon: 'upcoming_rain' });
  } else if (weatherData.humidity > 85) {
    probability += 8;
    factors.push({ name: 'Высокая влажность', score: 8, max: 40, icon: 'humidity' });
  } else {
    factors.push({ name: 'Нет осадков', score: 0, max: 40, icon: 'no_rain' });
  }

  // ═══════════════════════════════════════════
  // ФАКТОР 2: ПОЛОЖЕНИЕ СОЛНЦА (макс. 30 баллов)
  // Солнце должно быть над горизонтом, но ниже 42°
  // ═══════════════════════════════════════════
  const alt = sunPosition.altitude;
  
  if (!isSunUp(alt)) {
    // Солнце за горизонтом — радуга невозможна
    factors.push({ name: 'Солнце за горизонтом', score: 0, max: 30, icon: 'sun_down' });
  } else if (canRainbowBeVisible(alt)) {
    // Солнце в правильном диапазоне
    let sunScore;
    if (alt <= 5) {
      sunScore = 30; // Самое низкое солнце — самая высокая и полная радуга
    } else if (alt <= 15) {
      sunScore = 28;
    } else if (alt <= 25) {
      sunScore = 24;
    } else if (alt <= 35) {
      sunScore = 18;
    } else {
      sunScore = 12; // 35-42° — радуга видна, но очень низко
    }
    probability += sunScore;
    factors.push({ 
      name: `Солнце: ${alt.toFixed(1)}° (отлично)`, 
      score: sunScore, max: 30, icon: 'sun_good' 
    });
  } else {
    // Солнце слишком высоко (>42°) — радуга ниже горизонта
    factors.push({ 
      name: `Солнце: ${alt.toFixed(1)}° (слишком высоко)`, 
      score: 0, max: 30, icon: 'sun_high' 
    });
  }

  // ═══════════════════════════════════════════
  // ФАКТОР 3: ОБЛАЧНОСТЬ (макс. 15 баллов)
  // Нужны просветы для Солнца, но и облака/дождь
  // ═══════════════════════════════════════════
  const clouds = weatherData.cloudCover;
  
  if (clouds >= 20 && clouds <= 70) {
    // Идеально: переменная облачность
    const cloudScore = 15;
    probability += cloudScore;
    factors.push({ name: `Переменная облачность (${clouds}%)`, score: cloudScore, max: 15, icon: 'clouds_good' });
  } else if (clouds < 20) {
    // Мало облаков — мало шансов на дождь, но солнце есть
    const cloudScore = raining ? 12 : 5;
    probability += cloudScore;
    factors.push({ name: `Малая облачность (${clouds}%)`, score: cloudScore, max: 15, icon: 'clouds_few' });
  } else if (clouds <= 85) {
    // Много облаков, но возможны просветы
    const cloudScore = 8;
    probability += cloudScore;
    factors.push({ name: `Значительная облачность (${clouds}%)`, score: cloudScore, max: 15, icon: 'clouds_many' });
  } else {
    // Сплошная облачность — солнце не видно
    const cloudScore = 2;
    probability += cloudScore;
    factors.push({ name: `Сплошная облачность (${clouds}%)`, score: cloudScore, max: 15, icon: 'clouds_overcast' });
  }

  // ═══════════════════════════════════════════
  // ФАКТОР 4: ВЛАЖНОСТЬ И ВИДИМОСТЬ (макс. 15 баллов)
  // ═══════════════════════════════════════════
  const humidity = weatherData.humidity;
  const visibility = weatherData.visibility;
  
  let envScore = 0;
  
  // Влажность: 60-90% оптимально
  if (humidity >= 60 && humidity <= 95) {
    envScore += 8;
  } else if (humidity > 95) {
    envScore += 4; // Слишком влажно — туман
  } else if (humidity >= 40) {
    envScore += 3;
  }
  
  // Видимость: нужна достаточная для радуги (>3км)
  if (visibility >= 5000) {
    envScore += 7;
  } else if (visibility >= 3000) {
    envScore += 4;
  } else {
    envScore += 1; // Плохая видимость — туман скорее всего
  }
  
  probability += envScore;
  factors.push({ 
    name: `Влажность ${humidity}%, видимость ${(visibility/1000).toFixed(1)}км`, 
    score: envScore, max: 15, icon: 'environment' 
  });

  // ═══════════════════════════════════════════
  // ИТОГОВЫЙ РЕЗУЛЬТАТ
  // ═══════════════════════════════════════════
  probability = Math.min(95, Math.max(0, Math.round(probability)));
  
  // Определяем направление радуги
  const direction = getRainbowDirection(sunPosition);
  
  // Формируем статус и сообщение
  const { status, message } = getStatusMessage(probability, direction, sunPosition, raining);

  return {
    probability,
    direction,
    factors,
    status,
    message,
    sunPosition,
    isRaining: raining,
    precipType
  };
}

/**
 * Определяет направление, куда смотреть для радуги
 */
export function getRainbowDirection(sunPosition) {
  if (!sunPosition || sunPosition.altitude <= 0) {
    return null;
  }
  
  const antiSolarAz = getAntiSolarAzimuth(sunPosition.azimuth);
  
  return {
    // Азимут центра радуги (антисолнечная точка)
    azimuth: antiSolarAz,
    
    // Угловой радиус первичной радуги
    primaryRadius: 42,
    
    // Угловой радиус вторичной радуги
    secondaryRadius: 51,
    
    // Высота центра радуги над горизонтом (отрицательная — ниже горизонта)
    centerElevation: -sunPosition.altitude,
    
    // Высота верхней точки радуги
    topElevation: 42 - sunPosition.altitude,
    
    // Название направления
    directionName: getDirectionName(antiSolarAz),
    
    // Солнце за спиной — куда смотреть
    lookDirection: getDirectionName(antiSolarAz)
  };
}

/**
 * Возвращает название направления по азимуту
 */
export function getDirectionName(azimuth) {
  const dirs = [
    'Север', 'Северо-восток', 'Восток', 'Юго-восток',
    'Юг', 'Юго-запад', 'Запад', 'Северо-запад'
  ];
  const index = Math.round(azimuth / 45) % 8;
  return dirs[index];
}

/**
 * Возвращает краткое название направления
 */
export function getShortDirectionName(azimuth) {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const index = Math.round(azimuth / 45) % 8;
  return dirs[index];
}

/**
 * Формирует сообщение о текущем статусе
 */
function getStatusMessage(probability, direction, sunPosition, isRaining) {
  if (sunPosition.altitude <= 0) {
    return {
      status: 'night',
      message: 'Солнце за горизонтом. Радуга возможна только днём.'
    };
  }
  
  if (sunPosition.altitude >= 42) {
    return {
      status: 'sun_too_high',
      message: 'Солнце слишком высоко. Радуга будет видна ближе к восходу или закату.'
    };
  }
  
  if (probability >= 70) {
    return {
      status: 'high',
      message: `Отличные условия! Смотрите на ${direction?.directionName || 'горизонт'} (${direction?.azimuth?.toFixed(0) || '—'}°)`
    };
  }
  
  if (probability >= 40) {
    return {
      status: 'medium',
      message: isRaining 
        ? `Возможна радуга на ${direction?.directionName || ''} при просветах в облаках`
        : `Умеренные шансы. Смотрите на ${direction?.directionName || 'горизонт'} — там может появиться радуга`
    };
  }
  
  if (probability >= 15) {
    return {
      status: 'low',
      message: 'Малая вероятность. Условия неидеальны для радуги.'
    };
  }
  
  return {
    status: 'very_low',
    message: 'Условия неблагоприятны для радуги.'
  };
}
