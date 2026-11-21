const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class InputManager {
  constructor(canvas, touchUI, callbacks) {
    this.canvas = canvas;
    this.touchUI = touchUI;
    this.sneakButton = document.getElementById('bSneak');
    this.crouchButton = document.getElementById('bCrouch');
    this.execButton = document.getElementById('bExec');
    this.fireButton = document.getElementById('bFire');
    this.blockButton = document.getElementById('bBlock');
    this.healButton = document.getElementById('bNade');
    this.lockButton = document.getElementById('bJump');
    this.armoryButton = document.getElementById('bArmory');
    this.ultButtons = [
      document.getElementById('bUlt1'),
      document.getElementById('bUlt2'),
      document.getElementById('bUlt3')
    ];
    this.cb = callbacks;
    this.keys = {};
    this.mouse = {
      x: typeof window !== 'undefined' ? window.innerWidth * 0.5 : 640,
      y: typeof window !== 'undefined' ? window.innerHeight * 0.5 : 360,
      down: false,
      right: false,
      moved: false
    };
    this.isTouch = false;
    this.locked = false;
    this.touchFire = false;
    this.touchBlock = false;
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
      if (document.pointerLockElement === this.canvas) this.exitPointerLock();
      this.touchUI.hidden = false;
      this.cb.onResize?.();
    }
  }

  enableTouch() {
    this._setTouch();
  }

  updateStealthControls(sneaking, crouched, canExecute) {
    if (!this.isTouch) return;
    if (this.sneakButton && this.sneakButton.ariaPressed !== String(sneaking)) this.sneakButton.ariaPressed = String(sneaking);
    if (this.crouchButton && this.crouchButton.ariaPressed !== String(crouched)) this.crouchButton.ariaPressed = String(crouched);
    if (this.execButton && this.execButton.disabled === canExecute) this.execButton.disabled = !canExecute;
  }

  updateTouchHUD({
    coldMode = true,
    guardCounterReady = false,
    flasks = 0,
    maxFlasks = 4,
    lockedOn = false,
    canUpgrade = false,
    interactLabel = '绝杀',
    canInteract = false,
    ults = null
  } = {}) {
    if (!this.isTouch) return;
    this.touchUI?.classList?.toggle('cold-mode', !!coldMode);
    if (this.fireButton) {
      this.fireButton.classList?.toggle('gc-ready', !!guardCounterReady);
      const wantTxt = guardCounterReady ? '防反!' : '斩击';
      if (this.fireButton.textContent !== wantTxt) this.fireButton.textContent = wantTxt;
    }
    if (this.blockButton) {
      this.blockButton.classList?.toggle('is-holding', !!this.touchBlock);
    }
    if (this.healButton) {
      this.healButton.classList?.toggle('is-empty', flasks <= 0);
      const wantHeal = `药×${flasks}`;
      if (this.healButton.textContent !== wantHeal) this.healButton.textContent = wantHeal;
    }
    if (this.lockButton && this.lockButton.ariaPressed !== String(!!lockedOn)) {
      this.lockButton.ariaPressed = String(!!lockedOn);
    }
    if (this.armoryButton) {
      this.armoryButton.classList?.toggle('can-up', !!canUpgrade);
    }
    if (this.execButton) {
      this.execButton.disabled = !canInteract;
      if (this.execButton.textContent !== interactLabel) this.execButton.textContent = interactLabel;
    }
    if (ults && this.ultButtons) {
      for (let i = 0; i < 3; i++) {
        const btn = this.ultButtons[i];
        const u = ults[i];
        if (!btn || !u) continue;
        btn.classList?.toggle('is-ready', !!u.ready);
        btn.classList?.toggle('on-cd', !!u.onCd);
        const sub = btn.querySelector?.('small');
        if (sub) {
          const wantSub = u.onCd ? `${Math.ceil(u.cd)}s` : `${u.cost}气`;
          if (sub.textContent !== wantSub) sub.textContent = wantSub;
        }
      }
    }
  }

  _bind() {
    window.addEventListener('keydown', e => {
      if (e.target.closest?.('#motion-library')) return;
      // Menu controls use the browser's native radio, slider and tab navigation.
      if (e.target.closest?.('#ui:not([hidden]), #armory:not([hidden])') &&
          ['Space', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
      this.keys[e.code] = true;
      if (['Space', 'Tab', 'AltLeft', 'AltRight', 'F1', 'F2', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyP' || (e.code === 'Escape' && !this.locked)) { this.cb.onPause?.(); return; }
      if (e.repeat) return;
      this.cb.onKeyDown?.(e.code);
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.target.closest?.('#motion-library')) return;
      this.cb.onKeyUp?.(e.code);
    });

    window.addEventListener('blur', () => {
      for (const k in this.keys) this.keys[k] = false;
      this.mouse.down = this.mouse.right = false;
      this.touchFire = false;
      this.touchBlock = false;
      this.cb.onBlur?.();
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked && this.isTouch) this.exitPointerLock();
      if (was && !this.locked && !this.isTouch) this.cb.onPointerUnlock?.();
    });

    document.addEventListener('mousemove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = true;
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
      let lastTouchTs = 0;
      b.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        if (b.disabled) return;
        lastTouchTs = performance.now();
        this._setTouch();
        this.cb.onInteract?.();
        downFn();
      }, { passive: false });
      if (upFn) {
        const end = () => {
          lastTouchTs = performance.now();
          upFn();
        };
        b.addEventListener('touchend', end);
        b.addEventListener('touchcancel', end);
      }
      b.addEventListener('click', () => {
        if (b.disabled) return;
        // Prevent ghost click after real finger touch while still supporting stylus / hybrid / mouse taps
        if (performance.now() - lastTouchTs > 450) {
          downFn();
          if (upFn) upFn();
        }
        b.blur();
      });
    };

    bindTouchBtn('bJump', () => this.cb.onKeyDown?.('Tab'));
    bindTouchBtn('bGun', () => this.cb.onKeyDown?.('Digit1'));
    bindTouchBtn('bUlt1', () => this.cb.onKeyDown?.('Digit1'));
    bindTouchBtn('bUlt2', () => this.cb.onKeyDown?.('Digit2'));
    bindTouchBtn('bUlt3', () => this.cb.onKeyDown?.('Digit3'));
    bindTouchBtn('bRoll', () => this.cb.onKeyDown?.('AltLeft'));
    bindTouchBtn('bPause', () => this.cb.onPause?.());
    bindTouchBtn('bNade', () => this.cb.onKeyDown?.('KeyQ'));
    bindTouchBtn('bSneak', () => this.cb.onKeyDown?.('KeyC'));
    bindTouchBtn('bCrouch', () => this.cb.onKeyDown?.('KeyV'));
    bindTouchBtn('bExec', () => this.cb.onKeyDown?.('KeyE'));
    bindTouchBtn('bArmory', () => this.cb.onKeyDown?.('KeyU'));
    bindTouchBtn('bBlock', () => { this.touchBlock = true; }, () => { this.touchBlock = false; });
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
