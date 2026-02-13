/**
 * Главный модуль приложения Rainbow Finder
 * Координирует все подсистемы: геолокацию, компас, погоду, расчёт радуги
 */

import { getSunPosition } from './suncalc.js';
import { fetchWeather, fetchForecast, parseWeatherData, analyzeForecast } from './weather.js';
import { analyzeRainbowConditions, getShortDirectionName } from './rainbow.js';
import { CompassRenderer } from './compass.js';

class RainbowFinderApp {
  constructor() {
    // Состояние
    this.lat = null;
    this.lon = null;
    this.heading = 0;
    this.weatherData = null;
    this.forecastData = null;
    this.rainbowAnalysis = null;
    this.compass = null;
    this.watchId = null;
    this.weatherInterval = null;
    this.orientationPermission = false;
    
    // Элементы DOM
    this.els = {};
  }

  /**
   * Инициализация приложения
   */
  async init() {
    this._cacheDom();
    
    // Сразу показываем основной экран с компасом
    this._showScreen('main');
    
    // Инициализация компаса
    const canvas = document.getElementById('compass-canvas');
    if (canvas) {
      this.compass = new CompassRenderer(canvas);
      this.compass.start();
    }

    // Проверяем поддержку необходимых API
    if (!('geolocation' in navigator)) {
      this._showError('Геолокация не поддерживается вашим браузером');
      return;
    }

    // Сразу запрашиваем разрешения и запускаем
    await this._requestPermissions();

    // Регистрация Service Worker
    this._registerSW();
  }

  _cacheDom() {
    const ids = [
      'main-screen', 'error-screen',
      'city-name', 'weather-temp', 'weather-desc', 'weather-icon-text',
      'probability-value', 'probability-label', 'probability-fill',
      'direction-text', 'direction-details', 'status-message',
      'sun-altitude', 'sun-azimuth', 'humidity-value', 'wind-value',
      'clouds-value', 'visibility-value',
      'factor-list', 'heading-value',
      'error-message'
    ];
    for (const id of ids) {
      this.els[id] = document.getElementById(id);
    }
  }

  _showScreen(name) {
    const screens = ['main-screen', 'error-screen'];
    for (const s of screens) {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('active', s === `${name}-screen`);
    }
  }

  _showError(msg) {
    this._showScreen('error');
    if (this.els['error-message']) {
      this.els['error-message'].textContent = msg;
    }
  }

  /**
   * Запрашивает все необходимые разрешения
   */
  async _requestPermissions() {
    try {
      // 1. Геолокация — браузер сразу покажет запрос
      await this._initGeolocation();
      
      // 2. Ориентация устройства (компас)
      // На iOS requestPermission требует user gesture — 
      // повесим на первый тап по экрану
      this._initOrientationOnGesture();
      
      // 3. Загружаем погоду
      await this._loadWeather();
      
      // Запускаем обновление
      this._startUpdates();
      
    } catch (err) {
      console.error('Permission error:', err);
      this._showError(
        err.code === 1 
          ? 'Для работы приложения необходим доступ к геолокации. Разрешите доступ в настройках браузера.'
          : `Ошибка: ${err.message}`
      );
    }
  }

  /**
   * Инициализация геолокации
   */
  _initGeolocation() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.lat = pos.coords.latitude;
          this.lon = pos.coords.longitude;
          
          // Подписываемся на обновления
          this.watchId = navigator.geolocation.watchPosition(
            (p) => {
              this.lat = p.coords.latitude;
              this.lon = p.coords.longitude;
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 60000 }
          );
          
          resolve();
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  /**
   * Инициализация компаса (DeviceOrientation)
   * На Android — подключаемся сразу.
   * На iOS 13+ — requestPermission требует user gesture,
   * поэтому вешаем запрос на первый тап по экрану.
   */
  _initOrientationOnGesture() {
    const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function';

    if (needsPermission) {
      // iOS: запросим разрешение при первом тапе
      const handler = async () => {
        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission === 'granted') {
            this._bindOrientationListeners();
          }
        } catch (e) {
          console.warn('DeviceOrientationEvent.requestPermission error:', e);
        }
        document.removeEventListener('click', handler, true);
        document.removeEventListener('touchend', handler, true);
      };
      document.addEventListener('click', handler, true);
      document.addEventListener('touchend', handler, true);
    } else {
      // Android / desktop: подключаемся сразу
      this._bindOrientationListeners();
    }
  }

  _bindOrientationListeners() {
    window.addEventListener('deviceorientationabsolute', (e) => {
      this._handleOrientation(e);
    }, true);

    window.addEventListener('deviceorientation', (e) => {
      this._handleOrientation(e);
    }, true);
    
    this.orientationPermission = true;
  }

  _handleOrientation(event) {
    let heading = null;
    
    // iOS Safari
    if (event.webkitCompassHeading !== undefined) {
      heading = event.webkitCompassHeading;
    }
    // Android Chrome / абсолютная ориентация
    else if (event.absolute && event.alpha !== null) {
      heading = 360 - event.alpha;
    }
    // Обычная ориентация (относительная)
    else if (event.alpha !== null) {
      heading = 360 - event.alpha;
    }
    
    if (heading !== null) {
      this.heading = heading;
    }
  }

  /**
   * Загрузка данных о погоде
   */
  async _loadWeather() {
    if (!this.lat || !this.lon) return;
    
    try {
      const [weather, forecast] = await Promise.all([
        fetchWeather(this.lat, this.lon),
        fetchForecast(this.lat, this.lon)
      ]);
      
      this.weatherData = parseWeatherData(weather);
      this.forecastData = analyzeForecast(forecast);
      
      this._updateUI();
    } catch (err) {
      console.error('Weather fetch error:', err);
      // Продолжаем работу без погоды — рассчитываем хотя бы положение солнца
      this._updateUI();
    }
  }

  /**
   * Запуск периодических обновлений
   */
  _startUpdates() {
    // Обновление UI (каждый кадр через compass уже анимируется)
    // Дополнительное обновление данных каждые 500мс
    setInterval(() => this._updateUI(), 500);
    
    // Обновление погоды каждые 5 минут
    this.weatherInterval = setInterval(() => this._loadWeather(), 5 * 60 * 1000);
  }

  /**
   * Обновление всего UI
   */
  _updateUI() {
    const now = new Date();
    
    // Рассчитываем положение солнца
    const sunPos = (this.lat && this.lon) 
      ? getSunPosition(now, this.lat, this.lon) 
      : null;
    
    // Анализируем вероятность радуги
    if (this.weatherData && sunPos) {
      this.rainbowAnalysis = analyzeRainbowConditions(
        this.weatherData, this.forecastData, sunPos
      );
    }
    
    // Обновляем компас
    if (this.compass && sunPos) {
      const ra = this.rainbowAnalysis;
      this.compass.update({
        heading: this.heading,
        sunAzimuth: sunPos.azimuth,
        sunAltitude: sunPos.altitude,
        rainbowAzimuth: ra?.direction?.azimuth ?? (sunPos.azimuth + 180) % 360,
        probability: ra?.probability ?? 0,
        rainbowVisible: sunPos.altitude > 0 && sunPos.altitude < 42
      });
    }
    
    // Обновляем текстовую информацию
    this._updateWeatherPanel();
    this._updateProbabilityPanel();
    this._updateDirectionPanel(sunPos);
    this._updateDetailsPanel(sunPos);
    this._updateFactorsPanel();
    this._updateBackgroundTheme(sunPos);
  }

  _updateWeatherPanel() {
    const w = this.weatherData;
    if (!w) return;
    
    this._setText('city-name', w.cityName);
    this._setText('weather-temp', w.temp !== undefined ? `${Math.round(w.temp)}°` : '—');
    this._setText('weather-desc', w.weatherDescription || '');
    this._setText('weather-icon-text', this._getWeatherEmoji(w.weatherId));
  }

  _updateProbabilityPanel() {
    const ra = this.rainbowAnalysis;
    const prob = ra?.probability ?? 0;
    
    this._setText('probability-value', `${Math.round(prob)}%`);
    
    // Обновляем цвет и текст
    const el = this.els['probability-value'];
    if (el) {
      el.className = 'probability-number';
      if (prob >= 70) el.classList.add('prob-high');
      else if (prob >= 40) el.classList.add('prob-medium');
      else if (prob >= 15) el.classList.add('prob-low');
      else el.classList.add('prob-none');
    }
    
    // Заполнение прогресс-бара
    const fill = this.els['probability-fill'];
    if (fill) {
      fill.style.width = `${prob}%`;
      if (prob >= 70) fill.style.background = 'linear-gradient(90deg, #ff0000, #ff8800, #ffff00, #00cc00, #0088ff, #4400ff)';
      else if (prob >= 40) fill.style.background = 'linear-gradient(90deg, #ff8800, #ffcc00)';
      else if (prob >= 15) fill.style.background = '#8899aa';
      else fill.style.background = '#555';
    }
    
    // Текст вероятности
    let label = 'Нет данных';
    if (ra) {
      if (prob >= 70) label = 'Высокая вероятность радуги!';
      else if (prob >= 40) label = 'Умеренная вероятность';
      else if (prob >= 15) label = 'Малая вероятность';
      else label = 'Радуга маловероятна';
    }
    this._setText('probability-label', label);
  }

  _updateDirectionPanel(sunPos) {
    const ra = this.rainbowAnalysis;
    
    if (ra?.direction) {
      const dir = ra.direction;
      this._setText('direction-text', `Смотрите: ${dir.directionName} (${dir.azimuth.toFixed(0)}°)`);
      this._setText('direction-details', ra.message);
    } else if (sunPos && sunPos.altitude <= 0) {
      this._setText('direction-text', 'Ночное время');
      this._setText('direction-details', 'Радуга видна только при солнечном свете');
    } else {
      this._setText('direction-text', 'Определение направления...');
      this._setText('direction-details', '');
    }
    
    this._setText('heading-value', `${Math.round(this.heading)}° ${getShortDirectionName(this.heading)}`);
  }

  _updateDetailsPanel(sunPos) {
    if (sunPos) {
      this._setText('sun-altitude', `${sunPos.altitude.toFixed(1)}°`);
      this._setText('sun-azimuth', `${sunPos.azimuth.toFixed(1)}°`);
    }
    
    const w = this.weatherData;
    if (w) {
      this._setText('humidity-value', `${w.humidity}%`);
      this._setText('wind-value', w.windSpeed !== undefined ? `${w.windSpeed} м/с` : '—');
      this._setText('clouds-value', `${w.cloudCover}%`);
      this._setText('visibility-value', w.visibility ? `${(w.visibility / 1000).toFixed(1)} км` : '—');
    }
  }

  _updateFactorsPanel() {
    const ra = this.rainbowAnalysis;
    const list = this.els['factor-list'];
    if (!list || !ra?.factors) return;
    
    list.innerHTML = ra.factors.map(f => {
      const pct = Math.round((f.score / f.max) * 100);
      const colorClass = pct >= 70 ? 'factor-good' : pct >= 40 ? 'factor-medium' : 'factor-low';
      return `
        <div class="factor-item">
          <div class="factor-header">
            <span class="factor-name">${f.name}</span>
            <span class="factor-score">${f.score}/${f.max}</span>
          </div>
          <div class="factor-bar">
            <div class="factor-bar-fill ${colorClass}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  _updateBackgroundTheme(sunPos) {
    const app = document.getElementById('app');
    if (!app || !sunPos) return;
    
    let theme;
    if (sunPos.altitude <= -6) theme = 'theme-night';
    else if (sunPos.altitude <= 0) theme = 'theme-twilight';
    else if (sunPos.altitude <= 15) theme = 'theme-golden';
    else theme = 'theme-day';
    
    app.className = theme;
  }

  _getWeatherEmoji(id) {
    if (!id) return '';
    if (id >= 200 && id < 300) return '\u26C8';  // Гроза
    if (id >= 300 && id < 400) return '\ud83c\udf27'; // Морось
    if (id >= 500 && id < 600) return '\ud83c\udf27'; // Дождь
    if (id >= 600 && id < 700) return '\u2744';  // Снег
    if (id >= 700 && id < 800) return '\ud83c\udf2b'; // Туман
    if (id === 800) return '\u2600';              // Ясно
    if (id === 801) return '\ud83c\udf24';        // Мало облаков
    if (id <= 804) return '\u2601';               // Облачно
    return '';
  }

  _setText(id, text) {
    const el = this.els[id];
    if (el) el.textContent = text;
  }

  /**
   * Регистрация Service Worker
   */
  async _registerSW() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (e) {
        console.warn('SW registration failed:', e);
      }
    }
  }

  destroy() {
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    if (this.weatherInterval) clearInterval(this.weatherInterval);
    if (this.compass) this.compass.destroy();
  }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  const app = new RainbowFinderApp();
  app.init();
});
