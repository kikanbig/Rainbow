/**
 * Серверный модуль расчёта положения Солнца (CommonJS)
 * Алгоритмы NOAA Solar Calculator
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

function toJulian(date) { return date.valueOf() / DAY_MS - 0.5 + J1970; }
function toDays(date) { return toJulian(date) - J2000; }
function sinDeg(d) { return Math.sin(d * RAD); }
function cosDeg(d) { return Math.cos(d * RAD); }
function tanDeg(d) { return Math.tan(d * RAD); }
function asinDeg(x) { return Math.asin(x) * DEG; }
function atan2Deg(y, x) { return Math.atan2(y, x) * DEG; }

function solarCoordinates(d) {
  const M = (357.5291 + 0.98560028 * d) % 360;
  const C = 1.9148 * sinDeg(M) + 0.02 * sinDeg(2 * M) + 0.0003 * sinDeg(3 * M);
  const L = (M + C + 180 + 102.9372) % 360;
  const declination = asinDeg(sinDeg(L) * sinDeg(23.4393 - 3.563e-7 * d));
  const rightAscension = atan2Deg(sinDeg(L) * cosDeg(23.4393 - 3.563e-7 * d), cosDeg(L));
  return { declination, rightAscension };
}

function getSunPosition(date, lat, lng) {
  const d = toDays(date);
  const { declination, rightAscension } = solarCoordinates(d);
  const H = ((280.16 + 360.9856235 * d + lng) % 360) - rightAscension;

  const altitude = asinDeg(
    sinDeg(lat) * sinDeg(declination) +
    cosDeg(lat) * cosDeg(declination) * cosDeg(H)
  );

  let azimuth = atan2Deg(
    sinDeg(H),
    cosDeg(H) * sinDeg(lat) - tanDeg(declination) * cosDeg(lat)
  );
  azimuth = (azimuth + 180) % 360;

  return { azimuth, altitude };
}

module.exports = { getSunPosition };
