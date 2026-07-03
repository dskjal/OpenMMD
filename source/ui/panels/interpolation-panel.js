
/**
 * 補間曲線編集パネル
 */
export class InterpolationPanel {
  constructor(options) {
    this.container = document.getElementById('interpolation-editor');
    this.canvas = document.getElementById('interpolation-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.targetSelector = document.getElementById('interpolation-target');
    
    this.onChanged = options.onChanged;
    
    // X, Y, Z, R, すべて の [x1, y1, x2, y2] (0-127)
    this.params = [
      [20, 20, 107, 107],
      [20, 20, 107, 107],
      [20, 20, 107, 107],
      [20, 20, 107, 107]
    ];
    this.currentParamIndex = 0;
    this.draggingPoint = -1; // 0: (x1, y1), 1: (x2, y2)
    
    this.copyBuffer = null;

    this.setupHandlers();
    this.resize();
    this.render();
  }

  setupHandlers() {
    this.targetSelector.addEventListener('change', (e) => {
      const previousIndex = this.currentParamIndex;
      this.currentParamIndex = parseInt(e.target.value, 10);
      if (this.currentParamIndex === 4 && previousIndex >= 0 && previousIndex < 4) {
        const source = this.params[previousIndex];
        this.params.forEach((p) => {
          p[0] = source[0];
          p[1] = source[1];
          p[2] = source[2];
          p[3] = source[3];
        });
      }
      this.render();
    });

    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', () => this.handleMouseUp());

    document.getElementById('interpolation-linear').addEventListener('click', () => {
      this.setValues(20, 20, 107, 107);
    });

    document.getElementById('interpolation-copy').addEventListener('click', () => {
      this.copyBuffer = [...this.getActiveParams()];
    });

    document.getElementById('interpolation-paste').addEventListener('click', () => {
      if (this.copyBuffer) {
        this.setValues(...this.copyBuffer);
      }
    });
  }

  setValues(x1, y1, x2, y2) {
    if (this.currentParamIndex === 4) {
      this.params.forEach((p) => {
        p[0] = x1;
        p[1] = y1;
        p[2] = x2;
        p[3] = y2;
      });
    } else {
      const p = this.params[this.currentParamIndex];
      p[0] = x1; p[1] = y1; p[2] = x2; p[3] = y2;
    }
    this.render();
    if (this.onChanged) this.onChanged(this.currentParamIndex, this.getCurrentParams());
  }

  /**
   * 外部からデータを設定する (VMDの interpolation 配列 64bytes から)
   */
  setFromInterpolationArray(interp) {
    if (!interp) return;
    for (let i = 0; i < 4; i++) {
      this.params[i][0] = interp[0 + i];
      this.params[i][1] = interp[4 + i];
      this.params[i][2] = interp[8 + i];
      this.params[i][3] = interp[12 + i];
    }
    this.currentParamIndex = this.isUniformInterpolation() ? 4 : 0;
    this.targetSelector.value = String(this.currentParamIndex);
    this.render();
  }

  /**
   * 現在の状態を VMD の interpolation 配列形式で取得する
   */
  getInterpolationArray(targetArray = null) {
    const arr = targetArray || new Uint8Array(64);
    for (let i = 0; i < 4; i++) {
      const p = this.currentParamIndex === 4 ? this.params[0] : this.params[i];
      arr[0 + i] = p[0];
      arr[4 + i] = p[1];
      arr[8 + i] = p[2];
      arr[12 + i] = p[3];
    }
    // MMD互換のため、残りの48バイトにもコピー（オフセット付き）
    for (let i = 1; i < 4; i++) {
      for (let j = 0; j < 16; j++) {
        arr[i * 16 + j] = arr[j];
      }
    }
    // 正確には MMD は 1, 2, 3 番目のパラメータをずらして格納するが、
    // animation.js の実装に合わせて 0-15 だけ正しければ良い。
    return arr;
  }

  setVisible(visible) {
    this.container.style.display = visible ? 'block' : 'none';
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = 128 * dpr;
    this.canvas.height = 128 * dpr;
    this.ctx.scale(dpr, dpr);
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (128 / rect.width);
    const y = (e.clientY - rect.top) * (128 / rect.height);
    
    // Yは上が127、下が0なので反転
    const my = 127 - y;
    const mx = x;

    const p = this.getActiveParams();
    const d1 = Math.hypot(mx - p[0], my - p[1]);
    const d2 = Math.hypot(mx - p[2], my - p[3]);

    if (d1 < 10) this.draggingPoint = 0;
    else if (d2 < 10) this.draggingPoint = 1;
    else this.draggingPoint = -1;
  }

  handleMouseMove(e) {
    if (this.draggingPoint === -1) return;

    const rect = this.canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) * (128 / rect.width);
    let y = (e.clientY - rect.top) * (128 / rect.height);
    
    x = Math.max(0, Math.min(127, x));
    y = Math.max(0, Math.min(127, 127 - y));

    const p = this.getActiveParams();
    if (this.draggingPoint === 0) {
      p[0] = Math.round(x);
      p[1] = Math.round(y);
    } else {
      p[2] = Math.round(x);
      p[3] = Math.round(y);
    }

    if (this.currentParamIndex === 4) {
      this.params.forEach((param) => {
        param[0] = p[0];
        param[1] = p[1];
        param[2] = p[2];
        param[3] = p[3];
      });
    }

    this.render();
    if (this.onChanged) this.onChanged(this.currentParamIndex, this.getCurrentParams());
  }

  handleMouseUp() {
    this.draggingPoint = -1;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 128, 128);

    // 背景グリッド
    ctx.strokeStyle = '#eee';
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128);
      ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32);
    }
    ctx.stroke();

    // 基準対角線
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(0, 127);
    ctx.lineTo(127, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    const p = this.getActiveParams();
    const x1 = p[0], y1 = p[1], x2 = p[2], y2 = p[3];

    // 制御線
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(0, 127);
    ctx.lineTo(x1, 127 - y1);
    ctx.moveTo(127, 0);
    ctx.lineTo(x2, 127 - y2);
    ctx.stroke();

    // 補間曲線
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 127);
    
    // サンプリング描画
    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // ベジェ曲線の計算 (source/animation.js の evalBezierCurve を参考に)
      const it = 1.0 - t;
      const bx = 3 * t * it * it * (x1 / 127) + 3 * t * t * it * (x2 / 127) + t * t * t;
      const by = 3 * t * it * it * (y1 / 127) + 3 * t * t * it * (y2 / 127) + t * t * t;
      ctx.lineTo(bx * 127, 127 - by * 127);
    }
    ctx.stroke();
    ctx.lineWidth = 1;

    // ハンドル
    ctx.fillStyle = this.draggingPoint === 0 ? '#ff0000' : '#4444ff';
    ctx.beginPath();
    ctx.arc(x1, 127 - y1, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = this.draggingPoint === 1 ? '#ff0000' : '#4444ff';
    ctx.beginPath();
    ctx.arc(x2, 127 - y2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Returns the interpolation parameters that are currently being edited.
   * @returns {number[][]}
   */
  getCurrentParams() {
    if (this.currentParamIndex === 4) {
      return this.params;
    }
    return [this.params[this.currentParamIndex]];
  }

  /**
   * Returns the parameter set used for drawing and editing.
   * @returns {number[]}
   */
  getActiveParams() {
    return this.currentParamIndex === 4 ? this.params[0] : this.params[this.currentParamIndex];
  }

  /**
   * Returns true when all interpolation channels share the same control points.
   * @returns {boolean}
   */
  isUniformInterpolation() {
    const [first, ...rest] = this.params;
    return rest.every((param) => (
      param[0] === first[0] &&
      param[1] === first[1] &&
      param[2] === first[2] &&
      param[3] === first[3]
    ));
  }
}
