/**
 * Модуль расчёта положения Солнца
 * 
 * Основан на алгоритмах NOAA Solar Calculator и
 * Astronomical Algorithms Жана Меуса.
 * 
 * Научная база:
 * - Радуга образуется при преломлении света в каплях воды
 * - Центр радуги всегда находится в антисолнечной точке
 *   (точка на небе, диаметрально противоположная Солнцу)
 * - Первичная радуга: 42° от антисолнечной точки
 * - Вторичная радуга: 51° от антисолнечной точки
 * - Солнце должно быть ниже ~42° над горизонтом, чтобы радуга была видна
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function toDays(date) {
  return toJulian(date) - J2000;
}

// Вспомогательные тригонометрические функции в градусах
function sinDeg(deg) { return Math.sin(deg * RAD); }
function cosDeg(deg) { return Math.cos(deg * RAD); }
function tanDeg(deg) { return Math.tan(deg * RAD); }
function asinDeg(x) { return Math.asin(x) * DEG; }
function atan2Deg(y, x) { return Math.atan2(y, x) * DEG; }

/**
 * Вычисляет склонение и прямое восхождение Солнца
 */
function solarCoordinates(d) {
  // Средняя аномалия (градусы)
  const M = (357.5291 + 0.98560028 * d) % 360;
  
  // Уравнение центра
  const C = 1.9148 * sinDeg(M) + 0.02 * sinDeg(2 * M) + 0.0003 * sinDeg(3 * M);
  
  // Долгота перигелия
  const P = 102.9372;
  
  // Эклиптическая долгота Солнца
  const L = (M + C + 180 + P) % 360;
  
  // Наклон эклиптики
  const obliquity = 23.4393 - 3.563e-7 * d;
  
  // Склонение
  const declination = asinDeg(sinDeg(L) * sinDeg(obliquity));
  
  // Прямое восхождение
  const rightAscension = atan2Deg(
    sinDeg(L) * cosDeg(obliquity),
    cosDeg(L)
  );
  
  return { declination, rightAscension, eclipticLongitude: L };
}

/**
 * Вычисляет звёздное время в градусах
 */
function siderealTime(d, lng) {
  return (280.16 + 360.9856235 * d + lng) % 360;
}

/**
 * Рассчитывает положение Солнца (азимут и высоту)
 * 
 * @param {Date} date - дата и время
 * @param {number} lat - широта наблюдателя (градусы)
 * @param {number} lng - долгота наблюдателя (градусы)
 * @returns {{azimuth: number, altitude: number, declination: number}}
 *   azimuth: градусы от севера по часовой стрелке (0=N, 90=E, 180=S, 270=W)
 *   altitude: градусы над горизонтом (-90 до 90)
 */
export function getSunPosition(date, lat, lng) {
  const d = toDays(date);
  const { declination, rightAscension } = solarCoordinates(d);
  
  // Часовой угол
  const H = siderealTime(d, lng) - rightAscension;
  
  // Высота Солнца над горизонтом
  const altitude = asinDeg(
    sinDeg(lat) * sinDeg(declination) +
    cosDeg(lat) * cosDeg(declination) * cosDeg(H)
  );
  
  // Азимут Солнца (от юга, по часовой стрелке → конвертируем от севера)
  let azimuth = atan2Deg(
    sinDeg(H),
    cosDeg(H) * sinDeg(lat) - tanDeg(declination) * cosDeg(lat)
  );
  
  // Конвертация: от юга к от севера
  azimuth = (azimuth + 180) % 360;
  
  return { azimuth, altitude, declination };
}

/**
 * Рассчитывает направление антисолнечной точки
 * (центр радуги всегда в этой точке)
 * 
 * @param {number} sunAzimuth - азимут солнца в градусах
 * @returns {number} - азимут антисолнечной точки (градусы, 0-360)
 */
export function getAntiSolarAzimuth(sunAzimuth) {
  return (sunAzimuth + 180) % 360;
}

/**
 * Рассчитывает время восхода и заката
 * 
 * @param {Date} date - дата
 * @param {number} lat - широта
 * @param {number} lng - долгота
 * @returns {{sunrise: Date, sunset: Date, solarNoon: Date}}
 */
export function getSunTimes(date, lat, lng) {
  const d = toDays(date);
  const { declination, eclipticLongitude } = solarCoordinates(d);
  
  // Транзитное время (солнечный полдень)
  const Jtransit = J2000 + d + 0.0053 * sinDeg((357.5291 + 0.98560028 * d) % 360) 
                   - 0.0069 * sinDeg(2 * eclipticLongitude);
  
  // Часовой угол для восхода/заката (с учётом рефракции -0.833°)
  const cosH = (sinDeg(-0.833) - sinDeg(lat) * sinDeg(declination)) /
               (cosDeg(lat) * cosDeg(declination));
  
  if (cosH > 1) {
    // Полярная ночь
    return { sunrise: null, sunset: null, solarNoon: new Date((Jtransit - J1970 + 0.5) * DAY_MS) };
  }
  if (cosH < -1) {
    // Полярный день
    return { sunrise: null, sunset: null, solarNoon: new Date((Jtransit - J1970 + 0.5) * DAY_MS) };
  }
  
  const H = asinDeg(Math.sqrt(1 - cosH * cosH)) / 360; // В долях суток... нет, нужен acos
  const hourAngle = Math.acos(cosH) * DEG;
  const Hfrac = hourAngle / 360;
  
  const Jrise = Jtransit - Hfrac;
  const Jset = Jtransit + Hfrac;
  
  return {
    sunrise: new Date((Jrise - J1970 + 0.5) * DAY_MS),
    sunset: new Date((Jset - J1970 + 0.5) * DAY_MS),
    solarNoon: new Date((Jtransit - J1970 + 0.5) * DAY_MS)
  };
}

/**
 * Определяет, виден ли сейчас Солнце (над горизонтом)
 */
export function isSunUp(altitude) {
  return altitude > 0;
}

/**
 * Проверяет, достаточно ли низко Солнце для видимой радуги
 * Радуга видна только когда Солнце ниже ~42° над горизонтом
 */
export function canRainbowBeVisible(altitude) {
  return altitude > 0 && altitude < 42;
}
