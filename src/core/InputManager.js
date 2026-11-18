const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class InputManager {
  constructor(canvas, touchUI, callbacks) {
    this.canvas = canvas;
    this.touchUI = touchUI;
    this.cb = callbacks;
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false, right: false };
    this.isTouch = false;
    this.locked = false;
    this.touchFire = false;
    this.sticks = { move: null, look: null };

    this._bind();
  }

  lockPointer() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  exitPointerLock() {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  _setTouch() {
    if (!this.isTouch) {
      this.isTouch = true;
      this.touchUI.hidden = false;
      this.cb.onResize?.();
    }
  }

  _bind() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyP') { this.cb.onPause?.(); return; }
      if (e.repeat) return;
      this.cb.onKeyDown?.(e.code);
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      for (const k in this.keys) this.keys[k] = false;
      this.mouse.down = this.mouse.right = false;
      this.cb.onBlur?.();
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) this.cb.onPointerUnlock?.();
    });

    document.addEventListener('mousemove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.locked) {
        this.cb.onLookDelta?.(
          clamp(e.movementX, -120, 120) * 0.0023,
          clamp(e.movementY, -120, 120) * 0.0016
        );
      }
    });

    this.canvas.addEventListener('mousedown', e => {
      this.cb.onInteract?.();
      if (this.isTouch) return;
      if (!this.locked) this.cb.onRequestLock?.();
      if (e.button === 0) this.mouse.down = true;
      else if (e.button === 2) this.mouse.right = true;
      else if (e.button === 1) {
        e.preventDefault();
        this.cb.onMiddleClick?.();
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      else if (e.button === 2) this.mouse.right = false;
    });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('wheel', () => this.cb.onWheel?.(), { passive: true });

    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this._setTouch();
      this.cb.onInteract?.();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2) {
          if (!this.sticks.move) {
            this.sticks.move = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
          }
        } else if (!this.sticks.look) {
          this.sticks.look = { id: t.identifier, lx: t.clientX, ly: t.clientY };
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = this.sticks.move;
        const l = this.sticks.look;
        if (s && s.id === t.identifier) {
          let dx = (t.clientX - s.ox) / 52;
          let dy = (t.clientY - s.oy) / 52;
          const m = Math.hypot(dx, dy);
          if (m > 1) { dx /= m; dy /= m; }
          s.dx = dx;
          s.dy = dy;
        } else if (l && l.id === t.identifier) {
          this.cb.onLookDelta?.((t.clientX - l.lx) * 0.0065, (t.clientY - l.ly) * 0.004);
          l.lx = t.clientX;
          l.ly = t.clientY;
        }
      }
    }, { passive: false });

    const tEnd = e => {
      for (const t of e.changedTouches) {
        for (const k of ['move', 'look']) {
          if (this.sticks[k] && this.sticks[k].id === t.identifier) this.sticks[k] = null;
        }
      }
    };
    this.canvas.addEventListener('touchend', tEnd);
    this.canvas.addEventListener('touchcancel', tEnd);

    const bindTouchBtn = (id, downFn, upFn) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        this._setTouch();
        this.cb.onInteract?.();
        downFn();
      }, { passive: false });
      if (upFn) {
        b.addEventListener('touchend', upFn);
        b.addEventListener('touchcancel', upFn);
      }
      b.addEventListener('click', () => {
        if (!this.isTouch) {
          downFn();
          if (upFn) upFn();
        }
        b.blur();
      });
    };

    bindTouchBtn('bJump', () => this.cb.onKeyDown?.('Space'));
    bindTouchBtn('bGun', () => this.cb.onKeyDown?.('KeyQ'));
    bindTouchBtn('bRoll', () => this.cb.onKeyDown?.('ShiftLeft'));
    bindTouchBtn('bPause', () => this.cb.onPause?.());
    bindTouchBtn('bNade', () => this.cb.onKeyDown?.('KeyG'));
    bindTouchBtn('bFire', () => { this.touchFire = true; }, () => { this.touchFire = false; });
  }

  getMoveAxes() {
    let f = 0;
    let r = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) f++;
    if (this.keys.KeyS || this.keys.ArrowDown) f--;
    if (this.keys.KeyD) r++;
    if (this.keys.KeyA) r--;
    if (this.sticks.move) {
      r = this.sticks.move.dx;
      f = -this.sticks.move.dy;
    }
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    return { f, r };
  }
}
