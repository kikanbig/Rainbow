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
    // Цитата дня — показываем СРАЗУ, до всего остального
    try { this._showQuoteOfTheDay(); } catch(e) { console.warn('Quote error:', e); }

    try {
      // 1. Геолокация — браузер сразу покажет запрос
      await this._initGeolocation();
      
      // 2. Ориентация устройства (компас)
      this._initOrientationOnGesture();
      
      // 3. Загружаем погоду
      await this._loadWeather();
      
      // 4. Инициализация push-уведомлений
      this._initPushNotifications();
      
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
      // iOS: показываем подсказку и запрашиваем разрешение при первом тапе
      const hint = document.getElementById('ios-hint');
      if (hint) hint.style.display = 'block';

      const handler = async () => {
        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission === 'granted') {
            this._bindOrientationListeners();
          }
        } catch (e) {
          console.warn('DeviceOrientationEvent.requestPermission error:', e);
        }
        if (hint) hint.style.display = 'none';
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
      // Сразу передаём в компас для плавного вращения в реальном времени
      if (this.compass) {
        this.compass.update({ heading });
      }
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
    
    // Обновляем компас — heading всегда, остальное при наличии данных
    if (this.compass) {
      const update = { heading: this.heading };
      if (sunPos) {
        const ra = this.rainbowAnalysis;
        update.sunAzimuth = sunPos.azimuth;
        update.sunAltitude = sunPos.altitude;
        update.rainbowAzimuth = ra?.direction?.azimuth ?? (sunPos.azimuth + 180) % 360;
        update.probability = ra?.probability ?? 0;
        update.rainbowVisible = sunPos.altitude > 0 && sunPos.altitude < 42;
      }
      this.compass.update(update);
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
   * Регистрация Service Worker + система обновлений
   */
  async _registerSW() {
    if (!('serviceWorker' in navigator)) return;

    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');

      // Отслеживаем обновление SW
      this.swRegistration.addEventListener('updatefound', () => {
        const newWorker = this.swRegistration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          // Новый SW установлен и ждёт активации
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this._applyUpdate(newWorker);
          }
        });
      });

      // Если при загрузке уже есть ожидающий SW — применяем
      if (this.swRegistration.waiting) {
        this._applyUpdate(this.swRegistration.waiting);
      }

      // Когда новый SW взял контроль — перезагружаем страницу
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

    } catch (e) {
      console.warn('SW registration failed:', e);
    }

    // Запуск проверки версии с сервера
    this._startVersionChecker();
  }

  /**
   * Применяет обновление: показывает тост и активирует новый SW
   */
  _applyUpdate(waitingWorker) {
    this._showUpdateToast();
    // Через 1.5 секунды отправляем команду на активацию
    setTimeout(() => {
      waitingWorker.postMessage('SKIP_WAITING');
    }, 1500);
  }

  /**
   * Периодическая проверка версии через /api/version
   * Проверяет: каждые 60 сек + при возврате в приложение (visibilitychange)
   */
  _startVersionChecker() {
    // Получаем текущую версию при старте
    this._fetchVersion().then(v => { this._currentVersion = v; });

    // Проверка каждые 60 секунд
    setInterval(() => this._checkForUpdate(), 60 * 1000);

    // Проверка при возврате в приложение
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this._checkForUpdate();
        // Также просим браузер проверить обновление SW
        if (this.swRegistration) {
          this.swRegistration.update().catch(() => {});
        }
      }
    });
  }

  async _fetchVersion() {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.version || null;
    } catch (e) {
      return null;
    }
  }

  async _checkForUpdate() {
    const newVersion = await this._fetchVersion();
    if (!newVersion || !this._currentVersion) {
      if (newVersion) this._currentVersion = newVersion;
      return;
    }
    if (newVersion !== this._currentVersion) {
      console.log(`[Update] ${this._currentVersion} → ${newVersion}`);
      this._currentVersion = newVersion;
      this._showUpdateToast();
      // Принудительно проверяем SW
      if (this.swRegistration) {
        await this.swRegistration.update().catch(() => {});
        // Если есть waiting worker — активируем
        if (this.swRegistration.waiting) {
          this.swRegistration.waiting.postMessage('SKIP_WAITING');
        } else {
          // SW обновился сам, просто перезагрузим
          setTimeout(() => window.location.reload(), 2000);
        }
      } else {
        setTimeout(() => window.location.reload(), 2000);
      }
    }
  }

  /**
   * Показать тост "Обновление..."
   */
  _showUpdateToast() {
    // Не показываем повторно
    if (document.getElementById('update-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'update-toast';
    toast.className = 'update-toast';
    toast.innerHTML = '<span class="update-spinner"></span> Обновление приложения...';
    document.body.appendChild(toast);
    // Плавное появление
    requestAnimationFrame(() => toast.classList.add('visible'));
  }

  // ═══════════════════════════════════════════
  // PUSH-УВЕДОМЛЕНИЯ
  // ═══════════════════════════════════════════

  /**
   * Инициализация push-уведомлений
   * Вызывается после получения геолокации
   */
  async _initPushNotifications() {
    // Проверяем поддержку
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      this._updateNotifButton('unsupported');
      return;
    }

    // Ждём регистрации SW
    if (!this.swRegistration) {
      await new Promise(r => setTimeout(r, 1000));
      if (!this.swRegistration) {
        this._updateNotifButton('unsupported');
        return;
      }
    }

    // Проверяем текущую подписку
    try {
      const existing = await this.swRegistration.pushManager.getSubscription();
      if (existing) {
        this.pushSubscription = existing;
        // Пытаемся обновить координаты на сервере
        try {
          await this._sendLocationToServer(existing.endpoint);
          this._updateNotifButton('subscribed');
          console.log('✅ Подписка восстановлена после обновления');
        } catch (err) {
          // Если сервер не знает эту подписку — переподписываемся
          console.warn('Подписка устарела, переподписываемся...');
          await existing.unsubscribe();
          this.pushSubscription = null;
          this._updateNotifButton('default');
        }
      } else {
        this._updateNotifButton('default');
      }
    } catch (e) {
      console.warn('Push check error:', e);
      this._updateNotifButton('default');
    }
  }

  /**
   * Подписка на push-уведомления
   */
  async subscribePush() {
    try {
      // Запрашиваем разрешение
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this._updateNotifButton('denied');
        return;
      }

      // Получаем VAPID public key с сервера
      const keyRes = await fetch('/api/vapid-public-key');
      if (!keyRes.ok) {
        console.error('VAPID key not available');
        return;
      }
      const { publicKey } = await keyRes.json();

      // Подписываемся
      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(publicKey)
      });

      // Отправляем подписку на сервер
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          lat: this.lat,
          lon: this.lon
        })
      });

      this.pushSubscription = subscription;
      this._updateNotifButton('subscribed');
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
  }

  /**
   * Отписка от push-уведомлений
   */
  async unsubscribePush() {
    try {
      if (this.pushSubscription) {
        const endpoint = this.pushSubscription.endpoint;
        await this.pushSubscription.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint })
        });
        this.pushSubscription = null;
      }
      this._updateNotifButton('default');
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  }

  /**
   * Обновляет координаты на сервере
   * Бросает ошибку если подписка не найдена на сервере
   */
  async _sendLocationToServer(endpoint) {
    const res = await fetch('/api/push/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, lat: this.lat, lon: this.lon })
    });
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
  }

  /**
   * Обновляет состояние колокольчика уведомлений
   */
  _updateNotifButton(state) {
    const btn = document.getElementById('notif-btn');
    if (!btn) return;

    switch (state) {
      case 'subscribed':
        btn.classList.add('notif-active');
        btn.onclick = () => this.unsubscribePush();
        btn.title = 'Уведомления включены';
        break;
      case 'denied':
        btn.classList.remove('notif-active');
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.title = 'Уведомления заблокированы';
        break;
      case 'unsupported':
        btn.style.display = 'none';
        break;
      default:
        btn.classList.remove('notif-active');
        btn.onclick = () => this.subscribePush();
        btn.title = 'Включить уведомления';
    }
  }

  // ═══════════════════════════════════════════
  // ЦИТАТА ДНЯ
  // ═══════════════════════════════════════════

  _showQuoteOfTheDay() {
    const quotes = [
      'Радуга — это обещание солнца, что после дождя всегда будет свет.',
      'Жизнь бросает нам дождь, чтобы мы могли увидеть радугу.',
      'Без дождя не бывает радуги. Без трудностей — роста.',
      'Ищи радугу в каждом облаке.',
      'Радуга — это мост между дождём и солнцем, между грустью и радостью.',
      'Будь как радуга — появляйся после бури и дари свет.',
      'Тот, кто хочет увидеть радугу, должен научиться любить дождь.',
      'Каждый новый день — шанс увидеть свою радугу.',
      'Солнце всегда светит за облаками. Нужно лишь подождать.',
      'Радуга напоминает: самое красивое рождается из хаоса.',
      'Повернись к солнцу — и тени останутся позади.',
      'Небо после дождя чище, а радуга — ярче.',
      'Верь в радугу, даже когда идёт дождь.',
      'Каждая капля дождя несёт в себе частичку радуги.',
      'Мир прекрасен, когда смотришь на него сквозь радугу.',
      'Радуга не приходит к тем, кто прячется от дождя.',
      'Даже самая тёмная ночь заканчивается рассветом.',
      'Когда жизнь дарит тебе дождь — танцуй и жди радугу.',
      'Радуга — это улыбка неба после слёз.',
      'Счастье — как радуга: невозможно потрогать, но невозможно забыть.',
      'Смотри на небо чаще — оно полно чудес.',
      'В каждом из нас живёт своя радуга. Дай ей засиять.',
      'Самое красивое небо — то, что следует за бурей.',
      'Радуга не знает границ. Как и мечты.',
      'Дождь — это не конец. Это начало чего-то прекрасного.',
      'Пусть твой день будет таким же ярким, как радуга после грозы.',
      'Иногда нужно пройти через шторм, чтобы оценить тепло солнца.',
      'Радуга видна только тем, кто смотрит в правильном направлении.',
      'Цвета радуги есть в каждом из нас — нужно лишь позволить им раскрыться.',
      'Жизнь — это небо. Иногда дождь, иногда солнце, и всегда — надежда на радугу.',
      'Там, где заканчивается дождь — начинается волшебство.',
    ];

    // Выбираем цитату по дню года (меняется каждый день)
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const index = dayOfYear % quotes.length;

    const el = document.getElementById('quote-text');
    if (el) el.textContent = quotes[index];
  }

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
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
