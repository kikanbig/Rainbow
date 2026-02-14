/**
 * Рендерер компаса на Canvas
 * 
 * Отображает:
 * - Компас с направлениями (N/S/E/W)
 * - Положение Солнца
 * - Дугу радуги в правильном направлении
 * - Индикатор антисолнечной точки
 * - Кольцо вероятности
 */

export class CompassRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.heading = 0;          // Текущий курс устройства (градусы)
    this.targetHeading = 0;
    this.sunAzimuth = 0;       // Азимут солнца
    this.sunAltitude = 0;      // Высота солнца
    this.rainbowAzimuth = 180; // Направление радуги
    this.probability = 0;
    this.targetProbability = 0;
    this.animationId = null;
    this.rainbowVisible = false;
    this.rainbowHue = 0;       // Анимация переливания
    
    this._resize();
    this._bindResize();
  }

  _bindResize() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);
  }

  _resize() {
    const parent = this.canvas.parentElement;
    const size = Math.min(parent.clientWidth, parent.clientHeight, 400);
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    
    this.size = size;
    this.dpr = dpr;
    this.cx = (size * dpr) / 2;
    this.cy = (size * dpr) / 2;
    this.radius = (size * dpr) / 2 - 16 * dpr;
  }

  /**
   * Обновляет данные компаса
   */
  update({ heading, sunAzimuth, sunAltitude, rainbowAzimuth, probability, rainbowVisible }) {
    if (heading !== undefined) this.targetHeading = heading;
    if (sunAzimuth !== undefined) this.sunAzimuth = sunAzimuth;
    if (sunAltitude !== undefined) this.sunAltitude = sunAltitude;
    if (rainbowAzimuth !== undefined) this.rainbowAzimuth = rainbowAzimuth;
    if (probability !== undefined) this.targetProbability = probability;
    if (rainbowVisible !== undefined) this.rainbowVisible = rainbowVisible;
  }

  /**
   * Запускает анимацию
   */
  start() {
    const animate = () => {
      this._smoothValues();
      this._draw();
      this.rainbowHue = (this.rainbowHue + 0.3) % 360;
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _smoothValues() {
    // Плавная интерполяция курса (с учётом перехода через 0/360)
    let diff = this.targetHeading - this.heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    this.heading += diff * 0.1;
    if (this.heading < 0) this.heading += 360;
    if (this.heading >= 360) this.heading -= 360;
    
    // Плавная интерполяция вероятности
    this.probability += (this.targetProbability - this.probability) * 0.05;
  }

  _draw() {
    const { ctx, cx, cy, radius, dpr } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Угол поворота компаса (компас вращается обратно heading)
    const rotationRad = -this.heading * Math.PI / 180;

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Фоновый круг
    this._drawBackground(radius);

    // 2. Кольцо вероятности (внешнее)
    this._drawProbabilityRing(radius);

    // Всё дальше вращается с компасом
    ctx.rotate(rotationRad);

    // 3. Деления и метки
    this._drawTicks(radius);

    // 4. Направления N/S/E/W
    this._drawCardinals(radius);

    // 5. Дуга радуги
    if (this.rainbowVisible) {
      this._drawRainbowArc(radius);
    }

    // 6. Индикатор солнца
    if (this.sunAltitude > -5) {
      this._drawSunIndicator(radius);
    }

    // 7. Антисолнечная точка
    if (this.rainbowVisible) {
      this._drawAntiSolarPoint(radius);
    }

    ctx.restore();

    // 8. Центральный элемент (не вращается)
    this._drawCenter(cx, cy);

    // 9. Индикатор направления (треугольник сверху, не вращается)
    this._drawHeadingIndicator(cx, cy, radius);
  }

  _drawBackground(r) {
    const { ctx, dpr } = this;
    
    // Полупрозрачный светлый фон компаса
    const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.4)');
    
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Тонкая обводка
    ctx.strokeStyle = 'rgba(100, 140, 200, 0.4)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }

  _drawProbabilityRing(r) {
    const { ctx, dpr, probability } = this;
    const ringWidth = 6 * dpr;
    const ringR = r + 4 * dpr;
    
    // Фоновое кольцо
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = ringWidth;
    ctx.stroke();
    
    // Кольцо вероятности
    if (probability > 0) {
      const angle = (probability / 100) * Math.PI * 2;
      const startAngle = -Math.PI / 2;
      
      // Цвет зависит от вероятности
      let color;
      if (probability < 25) {
        color = `rgba(120, 130, 160, ${0.4 + probability/100})`;
      } else if (probability < 50) {
        color = `rgba(255, 200, 50, ${0.5 + probability/200})`;
      } else if (probability < 75) {
        color = `rgba(255, 140, 50, ${0.6 + probability/300})`;
      } else {
        // Радужный градиент для высокой вероятности
        try {
          const grad = ctx.createConicGradient(startAngle, 0, 0);
          grad.addColorStop(0, '#ff0000');
          grad.addColorStop(0.17, '#ff8800');
          grad.addColorStop(0.33, '#ffff00');
          grad.addColorStop(0.5, '#00cc00');
          grad.addColorStop(0.67, '#0088ff');
          grad.addColorStop(0.83, '#4400ff');
          grad.addColorStop(1, '#ff0000');
          color = grad;
        } catch(e) {
          // Fallback для старых браузеров
          color = `rgba(255, 100, 50, 0.9)`;
        }
      }
      
      ctx.beginPath();
      ctx.arc(0, 0, ringR, startAngle, startAngle + angle);
      ctx.strokeStyle = color;
      ctx.lineWidth = ringWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  _drawTicks(r) {
    const { ctx, dpr } = this;
    
    for (let i = 0; i < 360; i += 5) {
      const rad = i * Math.PI / 180;
      const isCardinal = i % 90 === 0;
      const isMajor = i % 30 === 0;
      const isMinor = i % 10 === 0;
      
      let innerR, outerR, width, color;
      
      if (isCardinal) {
        innerR = r * 0.82;
        outerR = r * 0.92;
        width = 2.5 * dpr;
        color = 'rgba(200, 220, 255, 0.9)';
      } else if (isMajor) {
        innerR = r * 0.85;
        outerR = r * 0.92;
        width = 1.5 * dpr;
        color = 'rgba(150, 170, 200, 0.6)';
      } else if (isMinor) {
        innerR = r * 0.88;
        outerR = r * 0.92;
        width = 1 * dpr;
        color = 'rgba(120, 140, 170, 0.4)';
      } else {
        innerR = r * 0.90;
        outerR = r * 0.92;
        width = 0.5 * dpr;
        color = 'rgba(100, 120, 150, 0.25)';
      }
      
      ctx.save();
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.moveTo(0, -innerR);
      ctx.lineTo(0, -outerR);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawCardinals(r) {
    const { ctx, dpr } = this;
    const fontSize = 18 * dpr;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const labels = [
      { text: 'С', angle: 0, color: '#ff4444' },
      { text: 'В', angle: 90, color: '#4a5568' },
      { text: 'Ю', angle: 180, color: '#4a5568' },
      { text: 'З', angle: 270, color: '#4a5568' }
    ];
    
    const labelR = r * 0.73;
    
    for (const label of labels) {
      const rad = label.angle * Math.PI / 180;
      const x = Math.sin(rad) * labelR;
      const y = -Math.cos(rad) * labelR;
      
      ctx.save();
      ctx.translate(x, y);
      // Компенсируем вращение текста, чтобы он был читаемый
      ctx.rotate(-(-this.heading * Math.PI / 180));
      // Нет, текст должен вращаться с компасом и быть читаемым
      // Просто оставим как есть — текст вращается с компасом
      ctx.restore();
      
      // Рисуем текст вращаемый с компасом
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = label.color;
      ctx.shadowColor = label.color;
      ctx.shadowBlur = label.text === 'С' ? 10 * dpr : 0;
      ctx.fillText(label.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Промежуточные направления (меньшим шрифтом)
    const subFontSize = 11 * dpr;
    ctx.font = `${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    
    const subLabels = [
      { text: 'СВ', angle: 45 },
      { text: 'ЮВ', angle: 135 },
      { text: 'ЮЗ', angle: 225 },
      { text: 'СЗ', angle: 315 }
    ];
    
    const subLabelR = r * 0.73;
    
    for (const label of subLabels) {
      const rad = label.angle * Math.PI / 180;
      const x = Math.sin(rad) * subLabelR;
      const y = -Math.cos(rad) * subLabelR;
      
      ctx.fillStyle = 'rgba(74, 85, 104, 0.6)';
      ctx.fillText(label.text, x, y);
    }
  }

  _drawRainbowArc(r) {
    const { ctx, dpr } = this;
    const azRad = this.rainbowAzimuth * Math.PI / 180;
    
    // Дуга радуги: ±60° от направления антисолнечной точки
    const arcSpan = 60 * Math.PI / 180;
    const startAngle = azRad - Math.PI / 2 - arcSpan;
    const endAngle = azRad - Math.PI / 2 + arcSpan;
    
    const arcR = r * 0.58;
    const arcWidth = 12 * dpr;
    
    // Рисуем саму радугу (многослойная)
    const rainbowColors = [
      { color: 'rgba(255, 0, 0, 0.7)', offset: -3 },    // Красный (внешний)
      { color: 'rgba(255, 127, 0, 0.7)', offset: -1.8 },
      { color: 'rgba(255, 255, 0, 0.65)', offset: -0.6 },
      { color: 'rgba(0, 200, 0, 0.65)', offset: 0.6 },
      { color: 'rgba(0, 127, 255, 0.7)', offset: 1.8 },
      { color: 'rgba(75, 0, 130, 0.6)', offset: 3 },     // Фиолетовый (внутренний)
    ];
    
    for (const band of rainbowColors) {
      ctx.beginPath();
      ctx.arc(0, 0, arcR + band.offset * dpr, startAngle, endAngle);
      ctx.strokeStyle = band.color;
      ctx.lineWidth = 2.5 * dpr;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    
    // Свечение вокруг радуги
    ctx.beginPath();
    ctx.arc(0, 0, arcR, startAngle, endAngle);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + this.probability / 500})`;
    ctx.lineWidth = arcWidth + 8 * dpr;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  _drawSunIndicator(r) {
    const { ctx, dpr } = this;
    const azRad = this.sunAzimuth * Math.PI / 180;
    
    // Позиция солнца на компасе
    const sunR = r * 0.58;
    const x = Math.sin(azRad) * sunR;
    const y = -Math.cos(azRad) * sunR;
    
    const dotR = 10 * dpr;
    
    // Свечение
    const glow = ctx.createRadialGradient(x, y, 0, x, y, dotR * 3);
    glow.addColorStop(0, 'rgba(255, 220, 50, 0.4)');
    glow.addColorStop(0.5, 'rgba(255, 180, 30, 0.15)');
    glow.addColorStop(1, 'rgba(255, 150, 0, 0)');
    
    ctx.beginPath();
    ctx.arc(x, y, dotR * 3, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    
    // Солнце
    const sunGrad = ctx.createRadialGradient(x, y, 0, x, y, dotR);
    sunGrad.addColorStop(0, '#fff8e0');
    sunGrad.addColorStop(0.4, '#ffdd44');
    sunGrad.addColorStop(1, '#ff9900');
    
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = sunGrad;
    ctx.fill();
    
    // Лучи
    const rayCount = 8;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2 + this.rainbowHue * 0.02;
      const rx1 = x + Math.cos(angle) * dotR * 1.3;
      const ry1 = y + Math.sin(angle) * dotR * 1.3;
      const rx2 = x + Math.cos(angle) * dotR * 2;
      const ry2 = y + Math.sin(angle) * dotR * 2;
      
      ctx.beginPath();
      ctx.moveTo(rx1, ry1);
      ctx.lineTo(rx2, ry2);
      ctx.strokeStyle = 'rgba(255, 200, 50, 0.4)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
  }

  _drawAntiSolarPoint(r) {
    const { ctx, dpr } = this;
    const azRad = this.rainbowAzimuth * Math.PI / 180;
    
    // Небольшой маркер в антисолнечной точке
    const ptR = r * 0.58;
    const x = Math.sin(azRad) * ptR;
    const y = -Math.cos(azRad) * ptR;
    
    // Перекрестие
    const size = 6 * dpr;
    ctx.strokeStyle = 'rgba(180, 200, 255, 0.5)';
    ctx.lineWidth = 1.5 * dpr;
    
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    
    // Кружок
    ctx.beginPath();
    ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180, 200, 255, 0.4)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }

  _drawCenter(cx, cy) {
    const { ctx, dpr } = this;
    
    // Центральная точка
    const centerR = 5 * dpr;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerR);
    grad.addColorStop(0, 'rgba(200, 220, 255, 0.9)');
    grad.addColorStop(1, 'rgba(100, 140, 200, 0.3)');
    
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  _drawHeadingIndicator(cx, cy, r) {
    const { ctx, dpr } = this;
    
    // Треугольник сверху
    const triSize = 10 * dpr;
    const triY = cy - r - 10 * dpr;
    
    ctx.beginPath();
    ctx.moveTo(cx, triY - triSize);
    ctx.lineTo(cx - triSize * 0.7, triY + triSize * 0.3);
    ctx.lineTo(cx + triSize * 0.7, triY + triSize * 0.3);
    ctx.closePath();
    
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = 8 * dpr;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  destroy() {
    this.stop();
  }
}
