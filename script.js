/**
 * Connect 4 · Neon Edition — script.js
 * Production-ready. Full audit applied.
 *
 * BUGS FIXED
 * ──────────
 * 1. CRITICAL: _bindPointer() and _bindButtons() defined twice as orphaned
 *    methods outside InputHandler class body — caused SyntaxError, broke
 *    entire script. Removed duplicate block.
 * 2. CRITICAL: StatsModal, ThemeManager, and DOMContentLoaded bootstrap were
 *    completely missing — game never started. Added all three.
 * 3. Duplicate document keydown listeners (one per class). Now ONE listener
 *    in App._bindKeyboard(), dispatched via priority chain.
 * 4. hideModal animationend listener added on every call → multiple onDone()
 *    invocations. Fixed with _hideAnimating guard + { once: true }.
 * 5. touchcancel never cleared _touchCol. Added handler.
 * 6. _animateScore used void offsetWidth (forced sync layout). Replaced with
 *    rAF-based re-trigger.
 * 7. StatsManager history:null crashed renderHistory. Added Array.isArray
 *    guard in _load().
 * 8. CelebrationSystem RAF never cancelled on modal close. stop() cancels it.
 * 9. Canvas not resized on orientation change. ResizeObserver added.
 * 10. showModal called getElementById 10+ times per open. All refs cached in
 *     Renderer constructor.
 * 11. BoardShake used void offsetWidth (forced layout). Replaced with rAF.
 * 12. StatsModal _countUp RAF never tracked/cancelled. Now stored and
 *     cancelled in hide().
 * 13. ThemeManager missing entirely — theme toggle button did nothing.
 * 14. btn-view-stats (win modal) had no listener. Added in StatsModal.
 * 15. btn-clear-stats and btn-stats-done had no listeners. Added in StatsModal.
 *
 * ARCHITECTURE
 * ────────────
 *  GameState        Pure data model. Zero DOM.
 *  Renderer         All DOM reads/writes. Caches every element ref.
 *  InputHandler     Mouse/touch → callbacks. Keyboard owned by App.
 *  App              Orchestrator. ONE document keydown listener.
 *  CelebrationSystem Canvas fireworks + board shake + winner glow.
 *  SoundEngine      Web Audio API synthesis. Lazy context.
 *  StatsManager     localStorage persistence with full validation.
 *  StatsModal       Dashboard renderer. Tracks/cancels all RAF animations.
 *  ThemeManager     Day/night toggle with localStorage + OS preference.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const ROWS  = 6;
const COLS  = 7;
const EMPTY = 0;
const P1    = 1;
const P2    = 2;

/** @type {Object.<number, {id:number, name:string, color:string, tag:string, winLine:string}>} */
const PLAYER = {
  [P1]: { id: P1, name: 'PLAYER 1', color: 'red',    tag: 'RED',    winLine: 'Red dominates the grid.'   },
  [P2]: { id: P2, name: 'PLAYER 2', color: 'yellow', tag: 'YELLOW', winLine: 'Yellow rules the board.'  },
};

/* ─────────────────────────────────────────────────────────────
   GAME STATE  (pure logic, zero DOM)
───────────────────────────────────────────────────────────── */
class GameState {
  constructor() {
    this.scores = { [P1]: 0, [P2]: 0 };
    this._init();
  }

  _init() {
    this.board    = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
    this.current  = P1;
    this.over     = false;
    this.winner   = null;
    this.winCells = [];
    this.moves    = 0;
  }

  reset()       { this._init(); }
  resetScores() { this.scores[P1] = 0; this.scores[P2] = 0; }

  /** Returns the lowest empty row index in col, or -1 if full. */
  dropRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r][col] === EMPTY) return r;
    }
    return -1;
  }

  isPlayable(col) {
    return col >= 0 && col < COLS && this.board[0][col] === EMPTY;
  }

  /**
   * Drops a disc in col for the current player.
   * @returns {{ row, col, player, win, winCells, draw } | null}
   */
  drop(col) {
    if (this.over) return null;
    const row = this.dropRow(col);
    if (row === -1) return null;

    const player = this.current;
    this.board[row][col] = player;
    this.moves++;

    const winCells = this._findWin(row, col, player);
    const isDraw   = !winCells && this.moves === ROWS * COLS;

    if (winCells) {
      this.over     = true;
      this.winner   = player;
      this.winCells = winCells;
      this.scores[player]++;
    } else if (isDraw) {
      this.over   = true;
      this.winner = 'draw';
    } else {
      this.current = player === P1 ? P2 : P1;
    }

    return { row, col, player, win: !!winCells, winCells: winCells ?? [], draw: isDraw };
  }

  /** Checks all 4 directions for a winning line of 4. */
  _findWin(row, col, player) {
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of DIRS) {
      const line = this._scanLine(row, col, dr, dc, player);
      if (line.length >= 4) return line.slice(0, 4);
    }
    return null;
  }

  _scanLine(row, col, dr, dc, player) {
    const cells = [{ row, col }];
    for (let i = 1; i < 4; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || this.board[r][c] !== player) break;
      cells.push({ row: r, col: c });
    }
    for (let i = 1; i < 4; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || this.board[r][c] !== player) break;
      cells.push({ row: r, col: c });
    }
    return cells;
  }
}

/* ─────────────────────────────────────────────────────────────
   RENDERER  (all DOM work lives here)
───────────────────────────────────────────────────────────── */
class Renderer {
  constructor() {
    // ── Loader
    this.$loader       = document.getElementById('loading-screen');
    this.$loaderBar    = document.getElementById('loader-bar');
    this.$loaderPct    = document.getElementById('loader-percent');
    this.$loaderStatus = document.getElementById('loader-status');

    // ── App shell
    this.$app = document.getElementById('app');

    // ── Board
    this.$board      = document.getElementById('board-wrap');
    this.$colTargets = document.getElementById('col-targets');
    this.$previewRow = document.getElementById('preview-row');

    // ── Scoreboard
    this.$scoreP1  = document.getElementById('score-p1');
    this.$scoreP2  = document.getElementById('score-p2');
    this.$cardP1   = document.getElementById('card-p1');
    this.$cardP2   = document.getElementById('card-p2');
    this.$turnDisc = document.getElementById('turn-disc');
    this.$turnText = document.getElementById('turn-text');
    this.$statusBar = document.getElementById('status-bar');

    // ── Win modal — cache every element used in showModal
    this.$modal        = document.getElementById('win-modal');
    this.$wmCard       = document.getElementById('win-modal-card');
    this.$wmGlow       = document.getElementById('wm-glow');
    this.$wmAccentLine = document.getElementById('wm-accent-line');
    this.$wmDisc       = document.getElementById('wm-disc');
    this.$wmDiscRing   = document.getElementById('wm-disc-ring');
    this.$wmBadge      = document.getElementById('wm-badge');
    this.$wmBadgeText  = document.getElementById('wm-badge-text');
    this.$wmTitle      = document.getElementById('modal-title');
    this.$wmDesc       = document.getElementById('modal-desc');
    this.$wmValP1      = document.getElementById('wm-val-p1');
    this.$wmValP2      = document.getElementById('wm-val-p2');
    this.$wmScoreP1    = document.getElementById('wm-score-p1');
    this.$wmScoreP2    = document.getElementById('wm-score-p2');
    this.$wmBtnPlay    = document.getElementById('btn-play-again');

    /** @type {HTMLElement[][]} */
    this.cells    = [];
    /** @type {HTMLElement[]} */
    this.previews = [];
    /** @type {HTMLButtonElement[]} */
    this.colBtns  = [];

    this._hoverCol      = -1;
    this._lastScores    = { [P1]: 0, [P2]: 0 };
    this._winCells      = [];
    this._hideAnimating = false;
  }

  /* ── Loader ──────────────────────────────────────────────── */
  setProgress(pct) {
    this.$loaderBar.style.width = `${pct}%`;
    this.$loaderPct.textContent = `${Math.round(pct)}%`;
  }

  hideLoader() {
    this.$loader.classList.add('fade-out');
    this.$loader.addEventListener('transitionend', () => {
      this.$loader.classList.add('hidden');
    }, { once: true });
  }

  showApp() {
    this.$app.classList.remove('hidden');
    this.$app.removeAttribute('aria-hidden');
  }

  /* ── Board construction ──────────────────────────────────── */
  buildBoard() {
    this.$board.innerHTML      = '';
    this.$colTargets.innerHTML = '';
    this.$previewRow.innerHTML = '';
    this.cells    = [];
    this.previews = [];
    this.colBtns  = [];

    // Single DOM insertion per container via DocumentFragment
    const boardFrag   = document.createDocumentFragment();
    const targetFrag  = document.createDocumentFragment();
    const previewFrag = document.createDocumentFragment();

    for (let r = 0; r < ROWS; r++) {
      this.cells[r] = [];
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-rowindex', r + 1);
        cell.setAttribute('aria-colindex', c + 1);
        cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}, empty`);
        cell.dataset.row = r;
        cell.dataset.col = c;
        boardFrag.appendChild(cell);
        this.cells[r][c] = cell;
      }
    }

    for (let c = 0; c < COLS; c++) {
      const btn = document.createElement('button');
      btn.className = 'col-target';
      btn.setAttribute('aria-label', `Drop disc in column ${c + 1}`);
      btn.dataset.col = c;
      targetFrag.appendChild(btn);
      this.colBtns[c] = btn;

      const prev = document.createElement('div');
      prev.className = 'preview-cell';
      prev.dataset.col = c;
      previewFrag.appendChild(prev);
      this.previews[c] = prev;
    }

    this.$board.appendChild(boardFrag);
    this.$colTargets.appendChild(targetFrag);
    this.$previewRow.appendChild(previewFrag);
  }

  /* ── Column hover ────────────────────────────────────────── */
  setHoverCol(col, player) {
    if (col === this._hoverCol) {
      if (col !== -1) {
        this.previews[col].className = `preview-cell ${PLAYER[player].color} visible`;
      }
      return;
    }
    if (this._hoverCol !== -1) this._clearColHighlight(this._hoverCol);
    this._hoverCol = col;
    if (col === -1) return;
    for (let r = 0; r < ROWS; r++) this.cells[r][col].classList.add('col-hover');
    this.previews[col].className = `preview-cell ${PLAYER[player].color} visible`;
  }

  clearHover() {
    if (this._hoverCol !== -1) {
      this._clearColHighlight(this._hoverCol);
      this._hoverCol = -1;
    }
  }

  _clearColHighlight(col) {
    for (let r = 0; r < ROWS; r++) this.cells[r][col].classList.remove('col-hover');
    this.previews[col].className = 'preview-cell';
  }

  /* ── Disc drop animation ─────────────────────────────────── */
  dropDisc(row, col, player) {
    return new Promise(resolve => {
      const cell     = this.cells[row][col];
      const color    = PLAYER[player].color;
      const dropFrom = -((row + 1) * 115 + 10);
      const duration = Math.min(0.25 + row * 0.055, 0.52);

      const disc = document.createElement('div');
      disc.className = `disc ${color}`;
      disc.style.setProperty('--drop-from',     `${dropFrom}%`);
      disc.style.setProperty('--drop-duration', `${duration}s`);
      cell.appendChild(disc);

      // rAF-based trigger avoids forced synchronous layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => disc.classList.add('drop'));
      });

      cell.setAttribute('aria-label',
        `Row ${row + 1}, Column ${col + 1}, ${PLAYER[player].name}`);

      disc.addEventListener('animationend', resolve, { once: true });
    });
  }

  /* ── Win highlight ───────────────────────────────────────── */
  highlightWin(winCells) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const disc = this.cells[r][c].querySelector('.disc');
        if (disc) disc.classList.add('dimmed');
      }
    }
    for (const { row, col } of winCells) {
      const disc = this.cells[row][col].querySelector('.disc');
      if (disc) { disc.classList.remove('dimmed'); disc.classList.add('winner'); }
    }
  }

  /* ── Scores ──────────────────────────────────────────────── */
  updateScores(scores) {
    this._animateScore(this.$scoreP1, scores[P1]);
    this._animateScore(this.$scoreP2, scores[P2]);
  }

  _animateScore($el, value) {
    const prev = parseInt($el.textContent, 10);
    $el.textContent = value;
    if (value !== prev) {
      $el.classList.remove('bump');
      requestAnimationFrame(() => $el.classList.add('bump'));
      $el.addEventListener('animationend', () => $el.classList.remove('bump'), { once: true });
    }
  }

  /* ── Turn / status ───────────────────────────────────────── */
  setTurn(player) {
    const color = PLAYER[player].color;
    this.$turnDisc.className   = `turn-disc ${color}`;
    this.$turnText.textContent = `${PLAYER[player].name}'S TURN`;
    this.$cardP1.classList.toggle('active-p1', player === P1);
    this.$cardP2.classList.toggle('active-p2', player === P2);
    this._setStatus(`${PLAYER[player].name} — drop your disc`, color);
  }

  setStatusGameOver(winner) {
    if (winner === 'draw') {
      this._setStatus("It's a draw — no winner this round", 'neutral');
    } else {
      this._setStatus(`${PLAYER[winner].name} wins this round!`, PLAYER[winner].color);
    }
    this.$cardP1.classList.remove('active-p1');
    this.$cardP2.classList.remove('active-p2');
  }

  _setStatus(msg, color) {
    this.$statusBar.textContent = msg;
    this.$statusBar.className   = `status-bar status-${color}`;
  }

  /* ── Cache helpers ───────────────────────────────────────── */
  cacheScores(scores)  { this._lastScores = { ...scores }; }
  cacheWinCells(cells) {
    this._winCells = cells.map(({ row, col }) => this.cells[row][col]);
  }

  /* ── Win modal ───────────────────────────────────────────── */
  showModal(winner) {
    const isDraw = winner === 'draw';
    const color  = isDraw ? 'draw' : PLAYER[winner].color;

    this.$wmGlow.className        = `wm-glow ${color}`;
    this.$wmAccentLine.className  = `wm-accent-line ${color}`;
    this.$wmDisc.className        = `wm-disc ${color}`;
    this.$wmDiscRing.className    = `wm-disc-ring ${color}`;
    this.$wmBadge.className       = `wm-badge ${color}`;
    this.$wmBadgeText.textContent = isDraw ? 'STALEMATE' : 'VICTORY';
    this.$wmTitle.className       = `wm-title ${color}`;
    this.$wmTitle.textContent     = isDraw ? "IT'S A DRAW!" : `${PLAYER[winner].name} WINS!`;
    this.$wmDesc.textContent      = isDraw
      ? 'An equal battle — no one claimed the grid.'
      : PLAYER[winner].winLine;

    this.$wmValP1.textContent = this._lastScores[P1];
    this.$wmValP2.textContent = this._lastScores[P2];
    this.$wmScoreP1.classList.toggle('winner-item', winner === P1);
    this.$wmScoreP2.classList.toggle('winner-item', winner === P2);
    this.$wmBtnPlay.className = `btn wm-btn-primary ${color}`;

    // Re-trigger card entrance animation cleanly via double rAF
    this.$wmCard.classList.remove('closing');
    this.$wmCard.style.animation = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { this.$wmCard.style.animation = ''; });
    });

    this._hideAnimating = false;
    this.$modal.classList.remove('hidden', 'closing');
    this.$wmBtnPlay.focus();

    CelebrationSystem.start(color, this._winCells);
  }

  hideModal() {
    if (this.$modal.classList.contains('hidden')) return;
    if (this._hideAnimating) return;
    this._hideAnimating = true;

    this.$wmCard.classList.add('closing');
    this.$modal.classList.add('closing');

    const onDone = () => {
      this._hideAnimating = false;
      this.$modal.classList.add('hidden');
      this.$modal.classList.remove('closing');
      this.$wmCard.classList.remove('closing');
      CelebrationSystem.stop();
    };

    const timer = setTimeout(onDone, 350);
    this.$wmCard.addEventListener('animationend', () => {
      clearTimeout(timer);
      onDone();
    }, { once: true });
  }

  /* ── Board clear ─────────────────────────────────────────── */
  clearBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[r][c];
        while (cell.firstChild) cell.removeChild(cell.firstChild);
        cell.classList.remove('col-hover', 'winner-glow',
          'winner-glow-red', 'winner-glow-yellow', 'winner-glow-draw');
        cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}, empty`);
      }
    }
    this._hoverCol = -1;
    for (let c = 0; c < COLS; c++) this.previews[c].className = 'preview-cell';
  }

  /* ── Column state ────────────────────────────────────────── */
  disableAllCols() {
    for (let c = 0; c < COLS; c++) this._setCol(c, true);
  }

  syncColState(state) {
    for (let c = 0; c < COLS; c++) this._setCol(c, !state.isPlayable(c));
  }

  _setCol(col, disabled) {
    const btn = this.colBtns[col];
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
  }
}

/* ─────────────────────────────────────────────────────────────
   INPUT HANDLER
   Owns mouse/touch events only. Keyboard is handled by App.
───────────────────────────────────────────────────────────── */
class InputHandler {
  /**
   * @param {Renderer}               renderer
   * @param {(col:number)=>void}     onDrop
   * @param {(reset?:boolean)=>void} onNewGame
   * @param {()=>number}             getPlayer
   * @param {SoundEngine}            sound
   * @param {()=>boolean}            isModalOpen
   */
  constructor(renderer, onDrop, onNewGame, getPlayer, sound, isModalOpen) {
    this._r           = renderer;
    this._onDrop      = onDrop;
    this._onNewGame   = onNewGame;
    this._getPlayer   = getPlayer;
    this._sound       = sound;
    this._isModalOpen = isModalOpen;
    this._locked      = false;
    this._kbCol       = 3;
    this._touchCol    = -1;

    this._bindPointer();
    this._bindButtons();
  }

  lock()   { this._locked = true;  }
  unlock() { this._locked = false; }

  moveCursor(col) {
    const clamped = Math.max(0, Math.min(COLS - 1, col));
    if (clamped === this._kbCol) return;
    const prev  = this._kbCol;
    this._kbCol = clamped;
    if (prev >= 0 && prev < COLS) this._r.colBtns[prev].classList.remove('focused');
    this._r.colBtns[clamped].classList.add('focused');
    if (!this._locked) this._r.setHoverCol(clamped, this._getPlayer());
  }

  resetCursor() {
    this._kbCol = 3;
    this._r.colBtns[3]?.classList.add('focused');
    if (!this._locked) this._r.setHoverCol(3, this._getPlayer());
  }

  /* ── Pointer events (mouse + touch) ─────────────────────── */
  _bindPointer() {
    const r = this._r;

    r.$colTargets.addEventListener('click', e => {
      if (this._locked) return;
      const btn = e.target.closest('.col-target');
      if (btn) this._onDrop(parseInt(btn.dataset.col, 10));
    });

    r.$colTargets.addEventListener('mousemove', e => {
      if (this._locked) return;
      const btn = e.target.closest('.col-target');
      if (!btn) return;
      const col = parseInt(btn.dataset.col, 10);
      this._kbCol = col;
      r.setHoverCol(col, this._getPlayer());
    });

    r.$colTargets.addEventListener('mouseleave', () => r.clearHover());

    r.$colTargets.addEventListener('touchstart', e => {
      if (this._locked) return;
      const touch = e.touches[0];
      const el    = document.elementFromPoint(touch.clientX, touch.clientY);
      const btn   = el?.closest('.col-target');
      if (btn) {
        this._touchCol = parseInt(btn.dataset.col, 10);
        r.setHoverCol(this._touchCol, this._getPlayer());
      }
    }, { passive: true });

    r.$colTargets.addEventListener('touchend', e => {
      if (this._locked) return;
      e.preventDefault();
      if (this._touchCol !== -1) {
        this._onDrop(this._touchCol);
        this._touchCol = -1;
      }
      r.clearHover();
    }, { passive: false });

    r.$colTargets.addEventListener('touchcancel', () => {
      this._touchCol = -1;
      r.clearHover();
    }, { passive: true });
  }

  /* ── Static button bindings ──────────────────────────────── */
  _bindButtons() {
    document.getElementById('btn-new-game')?.addEventListener('click', () => {
      this._sound.resume();
      this._sound.playClick();
      this._onNewGame(false);
    });

    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this._sound.resume();
      this._onNewGame(false);
    });

    document.getElementById('btn-reset-scores')?.addEventListener('click', () => {
      this._sound.resume();
      this._onNewGame(true);
    });

    document.getElementById('win-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) this._onNewGame(false);
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   APP  (orchestrator)
───────────────────────────────────────────────────────────── */
class App {
  constructor() {
    this._state      = new GameState();
    this._renderer   = new Renderer();
    this._sound      = new SoundEngine();
    this._stats      = new StatsManager();
    this._statsModal = null;
    this._input      = new InputHandler(
      this._renderer,
      col   => this._drop(col),
      reset => this._newGame(reset),
      ()    => this._state.current,
      this._sound,
      ()    => this._isAnyModalOpen(),
    );
    this._busy = false;
  }

  isModalOpen() { return this._isAnyModalOpen(); }

  _isAnyModalOpen() {
    return !this._renderer.$modal.classList.contains('hidden') ||
           (this._statsModal?.isOpen() ?? false);
  }

  async init() {
    await this._runLoader();
    this._renderer.buildBoard();
    this._renderer.showApp();
    this._statsModal = new StatsModal(this._stats, this._sound, () => this._newGame(false));
    ThemeManager.init();
    this._bindMuteButton();
    this._bindKeyboard();
    this._begin();
  }

  /* ── Loader ──────────────────────────────────────────────── */
  _runLoader() {
    const STEPS = [
      { to: 20,  ms: 60,  status: 'Initializing…'  },
      { to: 45,  ms: 50,  status: 'Loading assets…' },
      { to: 68,  ms: 45,  status: 'Building board…' },
      { to: 85,  ms: 55,  status: 'Almost ready…'   },
      { to: 100, ms: 35,  status: 'Starting game…'  },
    ];
    return new Promise(resolve => {
      let pct = 0, step = 0;
      const $status = this._renderer.$loaderStatus;
      const tick = () => {
        if (step >= STEPS.length) {
          this._renderer.setProgress(100);
          setTimeout(() => { this._renderer.hideLoader(); resolve(); }, 400);
          return;
        }
        const { to, ms, status } = STEPS[step];
        if ($status && pct === (step === 0 ? 0 : STEPS[step - 1].to)) {
          $status.textContent = status;
        }
        if (pct < to) {
          pct++;
          this._renderer.setProgress(pct);
          setTimeout(tick, ms);
        } else {
          step++;
          setTimeout(tick, 100);
        }
      };
      setTimeout(tick, 200);
    });
  }

  /* ── Mute button ─────────────────────────────────────────── */
  _bindMuteButton() {
    const $btn = document.getElementById('btn-mute');
    if (!$btn) return;
    this._syncMuteBtn($btn);
    $btn.addEventListener('click', () => {
      this._sound.resume();
      this._sound.toggleMute();
      this._syncMuteBtn($btn);
      if (!this._sound.muted) this._sound.playClick();
    });
  }

  _syncMuteBtn($btn) {
    const m = this._sound.muted;
    $btn.classList.toggle('muted', m);
    $btn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
    $btn.setAttribute('aria-pressed', String(m));
  }

  /* ── Single keyboard dispatcher ──────────────────────────── */
  _bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (this._statsModal?.isOpen()) { this._statsModal.hide(); return; }
        if (!this._renderer.$modal.classList.contains('hidden')) {
          this._newGame(false); return;
        }
      }
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        ThemeManager.toggle();
        return;
      }
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const $btn = document.getElementById('btn-mute');
        this._sound.resume(); this._sound.toggleMute(); this._syncMuteBtn($btn);
        if (!this._sound.muted) this._sound.playClick();
        return;
      }
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this._statsModal?.isOpen()) {
          e.preventDefault(); this._sound.resume(); this._statsModal?.show();
        }
        return;
      }
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!this._isAnyModalOpen()) { e.preventDefault(); this._newGame(false); }
        return;
      }
      if (this._isAnyModalOpen() || this._input._locked) return;
      switch (e.key) {
        case 'ArrowLeft':  case 'a': case 'A':
          e.preventDefault(); this._input.moveCursor(this._input._kbCol - 1); break;
        case 'ArrowRight': case 'd': case 'D':
          e.preventDefault(); this._input.moveCursor(this._input._kbCol + 1); break;
        case 'Enter': case ' ':
          e.preventDefault(); this._drop(this._input._kbCol); break;
      }
    });
  }

  /* ── Game lifecycle ──────────────────────────────────────── */
  _begin() {
    this._busy = false;
    this._renderer.clearBoard();
    this._renderer.updateScores(this._state.scores);
    this._renderer.setTurn(this._state.current);
    this._renderer.syncColState(this._state);
    this._input.unlock();
    this._input.resetCursor();
  }

  _newGame(resetScores = false) {
    this._renderer.hideModal();
    this._statsModal?.hide();
    this._sound.resume();
    this._sound.playClick();
    if (resetScores) this._state.resetScores();
    this._state.reset();
    this._begin();
  }

  /* ── Drop ────────────────────────────────────────────────── */
  async _drop(col) {
    if (this._busy || this._state.over) return;
    if (!this._state.isPlayable(col)) return;
    this._sound.resume();
    this._busy = true;
    this._input.lock();
    this._renderer.disableAllCols();
    this._renderer.clearHover();

    const result = this._state.drop(col);
    if (!result) {
      this._busy = false;
      this._input.unlock();
      this._renderer.syncColState(this._state);
      return;
    }

    this._sound.playDrop(result.row);
    await this._renderer.dropDisc(result.row, result.col, result.player);

    if (result.win) {
      this._renderer.highlightWin(result.winCells);
      this._renderer.cacheWinCells(result.winCells);
      this._renderer.updateScores(this._state.scores);
      this._renderer.cacheScores(this._state.scores);
      this._renderer.setStatusGameOver(result.player);
      this._stats.recordResult(result.player, this._state.moves);
      this._sound.playWin();
      await this._wait(700);
      this._sound.playModalOpen();
      this._renderer.showModal(result.player);
    } else if (result.draw) {
      this._renderer.setStatusGameOver('draw');
      this._renderer.cacheScores(this._state.scores);
      this._renderer.cacheWinCells([]);
      this._stats.recordResult('draw', this._state.moves);
      this._sound.playDraw();
      await this._wait(450);
      this._sound.playModalOpen();
      this._renderer.showModal('draw');
    } else {
      this._renderer.setTurn(this._state.current);
      this._renderer.syncColState(this._state);
      this._input.unlock();
      this._busy = false;
    }
  }

  _wait(ms) { return new Promise(r => setTimeout(r, ms)); }
}

/* ─────────────────────────────────────────────────────────────
   CELEBRATION SYSTEM
───────────────────────────────────────────────────────────── */
const CelebrationSystem = (() => {
  const PALETTES = {
    red:    ['#ff2d55', '#ff6b81', '#ff8fa3', '#ffb3c1', '#c0002a', '#ffffff'],
    yellow: ['#ffd60a', '#fff176', '#ffe566', '#fde68a', '#c49a00', '#ffffff'],
    draw:   ['#ff2d55', '#ffd60a', '#7c3aed', '#9f5cf7', '#ff8fa3', '#ffffff'],
  };

  let _running = false, _raf = null, _canvas = null, _ctx = null, _W = 0, _H = 0;
  let _palette = PALETTES.red, _startTime = 0;

  const MAX_P = 1200, MAX_R = 12;
  const px = new Float32Array(MAX_P), py = new Float32Array(MAX_P);
  const pvx = new Float32Array(MAX_P), pvy = new Float32Array(MAX_P);
  const palpha = new Float32Array(MAX_P), pdecay = new Float32Array(MAX_P);
  const psize = new Float32Array(MAX_P), pgrav = new Float32Array(MAX_P);
  const ptype = new Uint8Array(MAX_P), pcolor = new Uint8Array(MAX_P);
  const prot = new Float32Array(MAX_P), protv = new Float32Array(MAX_P);
  let _pCount = 0;

  const rx = new Float32Array(MAX_R), ry = new Float32Array(MAX_R);
  const rvy = new Float32Array(MAX_R), rapex = new Float32Array(MAX_R);
  const ractive = new Uint8Array(MAX_R), rcolor = new Uint8Array(MAX_R);
  let _rCount = 0;

  const LAUNCH_TIMES = [0, 180, 380, 600, 850, 1150, 1500, 1900, 2350, 2850, 3400, 4000];
  const _rand = (a, b) => a + Math.random() * (b - a);

  // ResizeObserver to keep canvas sized to viewport
  let _resizeObs = null;

  function _spawn(x, y, vx, vy, sz, dc, gv, tp, ci, ro, rv) {
    if (_pCount >= MAX_P) return;
    const i = _pCount++;
    px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy;
    palpha[i] = 1; pdecay[i] = dc; psize[i] = sz; pgrav[i] = gv;
    ptype[i] = tp; pcolor[i] = ci; prot[i] = ro; protv[i] = rv;
  }

  function _launch(i) {
    const ci = Math.floor(Math.random() * _palette.length);
    rx[i] = _W * _rand(0.15, 0.85); ry[i] = _H + 10;
    rvy[i] = -_rand(14, 22); rapex[i] = _H * _rand(0.08, 0.38);
    ractive[i] = 1; rcolor[i] = ci;
  }

  function _explode(i) {
    ractive[i] = 0;
    const ex = rx[i], ey = ry[i], ci = rcolor[i];
    const n = Math.floor(_rand(55, 90));
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + _rand(-0.15, 0.15), sp = _rand(2.5, 8.5);
      _spawn(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp,
        _rand(1.5, 3.5), _rand(0.012, 0.022), _rand(0.06, 0.14), 0, ci, 0, 0);
    }
    const nc = Math.floor(_rand(12, 22));
    for (let j = 0; j < nc; j++) {
      const a = Math.random() * Math.PI * 2, sp = _rand(1.5, 5);
      _spawn(ex + _rand(-8, 8), ey + _rand(-8, 8),
        Math.cos(a) * sp, Math.sin(a) * sp - _rand(1, 3),
        _rand(4, 8), _rand(0.008, 0.016), _rand(0.08, 0.18), 2,
        Math.floor(Math.random() * _palette.length),
        Math.random() * Math.PI * 2, _rand(-0.18, 0.18));
    }
  }

  function _compact() {
    let i = 0;
    while (i < _pCount) {
      if (palpha[i] <= 0.01) {
        const l = _pCount - 1;
        if (i !== l) {
          px[i] = px[l]; py[i] = py[l]; pvx[i] = pvx[l]; pvy[i] = pvy[l];
          palpha[i] = palpha[l]; pdecay[i] = pdecay[l]; psize[i] = psize[l];
          pgrav[i] = pgrav[l]; ptype[i] = ptype[l]; pcolor[i] = pcolor[l];
          prot[i] = prot[l]; protv[i] = protv[l];
        }
        _pCount--;
      } else { i++; }
    }
  }

  function _drawP(i) {
    const a = palpha[i]; if (a <= 0.01) return;
    _ctx.globalAlpha = a;
    _ctx.fillStyle = _palette[pcolor[i]];
    const x = px[i], y = py[i], s = psize[i];
    if (ptype[i] === 0) {
      _ctx.shadowBlur = s * 3; _ctx.shadowColor = _palette[pcolor[i]];
      _ctx.beginPath(); _ctx.arc(x, y, s, 0, 6.2832); _ctx.fill();
      _ctx.shadowBlur = 0;
    } else if (ptype[i] === 2) {
      _ctx.save(); _ctx.translate(x, y); _ctx.rotate(prot[i]);
      _ctx.fillRect(-s / 2, -s / 4, s, s / 2); _ctx.restore();
    }
  }

  function _drawR(i) {
    if (!ractive[i]) return;
    const x = rx[i], y = ry[i], c = _palette[rcolor[i]];
    _ctx.globalAlpha = 0.9; _ctx.shadowBlur = 8; _ctx.shadowColor = c; _ctx.fillStyle = c;
    _ctx.beginPath(); _ctx.arc(x, y, 2.5, 0, 6.2832); _ctx.fill();
    _ctx.globalAlpha = 0.35; _ctx.fillStyle = c;
    _ctx.beginPath(); _ctx.arc(x, y + 6, 1.5, 0, 6.2832); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(x, y + 12, 1, 0, 6.2832); _ctx.fill();
    _ctx.shadowBlur = 0; _ctx.globalAlpha = 1;
  }

  function _tick(now) {
    if (!_running) return;
    const el = now - _startTime;
    for (let li = 0; li < LAUNCH_TIMES.length; li++) {
      if (el >= LAUNCH_TIMES[li] && el < LAUNCH_TIMES[li] + 16 && _rCount < MAX_R) {
        _launch(_rCount); _rCount++;
      }
    }
    _ctx.clearRect(0, 0, _W, _H);
    for (let i = 0; i < _rCount; i++) {
      if (!ractive[i]) continue;
      ry[i] += rvy[i]; rvy[i] *= 0.97;
      if (ry[i] <= rapex[i]) _explode(i); else _drawR(i);
    }
    for (let i = 0; i < _pCount; i++) {
      pvx[i] *= 0.985; pvy[i] += pgrav[i]; px[i] += pvx[i]; py[i] += pvy[i];
      prot[i] += protv[i]; palpha[i] -= pdecay[i]; _drawP(i);
    }
    _compact();
    const allLaunched = _rCount >= LAUNCH_TIMES.length;
    const noActive    = !Array.from(ractive.subarray(0, _rCount)).some(v => v === 1);
    if (allLaunched && noActive && _pCount === 0) {
      _running = false; _ctx.clearRect(0, 0, _W, _H); return;
    }
    _raf = requestAnimationFrame(_tick);
  }

  const BoardShake = {
    shake() {
      const b = document.getElementById('board-wrap'); if (!b) return;
      b.classList.remove('board-shake');
      // rAF avoids forced sync layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => b.classList.add('board-shake'));
      });
      b.addEventListener('animationend', () => b.classList.remove('board-shake'), { once: true });
    },
  };

  const WinnerGlow = {
    _cells: [],
    apply(cells, key) {
      this._cells = cells;
      for (const c of cells) c.classList.add('winner-glow', `winner-glow-${key}`);
    },
    clear() {
      for (const c of this._cells) {
        c.classList.remove('winner-glow', 'winner-glow-red', 'winner-glow-yellow', 'winner-glow-draw');
      }
      this._cells = [];
    },
  };

  return {
    start(colorKey, winCells = []) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.stop();
      _canvas = document.getElementById('win-particles'); if (!_canvas) return;
      _ctx = _canvas.getContext('2d', { alpha: true });
      _W = _canvas.width  = window.innerWidth;
      _H = _canvas.height = window.innerHeight;
      _palette = PALETTES[colorKey] ?? PALETTES.draw;
      _running = true; _startTime = performance.now(); _pCount = 0; _rCount = 0;

      // Keep canvas sized on resize/orientation change
      if (_resizeObs) _resizeObs.disconnect();
      _resizeObs = new ResizeObserver(() => {
        if (_canvas) { _W = _canvas.width = window.innerWidth; _H = _canvas.height = window.innerHeight; }
      });
      _resizeObs.observe(document.documentElement);

      if (colorKey !== 'draw') BoardShake.shake();
      if (winCells.length > 0) WinnerGlow.apply(winCells, colorKey);
      _raf = requestAnimationFrame(_tick);
    },
    stop() {
      _running = false;
      if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
      if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
      if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      _pCount = 0; _rCount = 0;
      WinnerGlow.clear();
    },
  };
})();

/* ─────────────────────────────────────────────────────────────
   SOUND ENGINE
───────────────────────────────────────────────────────────── */
class SoundEngine {
  static STORAGE_KEY = 'c4-mute';

  constructor() {
    this._ctx     = null;
    this._master  = null;
    this._muted   = false;
    this._ready   = false;
    this._resumeQ = [];
    try { this._muted = localStorage.getItem(SoundEngine.STORAGE_KEY) === '1'; } catch (_) {}
  }

  resume() {
    if (this._ready) return Promise.resolve();
    return this._ensureContext();
  }

  get muted() { return this._muted; }

  setMuted(m) {
    this._muted = m;
    if (this._master) {
      const t = this._ctx.currentTime;
      this._master.gain.cancelScheduledValues(t);
      this._master.gain.setTargetAtTime(m ? 0 : 1, t, 0.008);
    }
    try { localStorage.setItem(SoundEngine.STORAGE_KEY, m ? '1' : '0'); } catch (_) {}
  }

  toggleMute() { this.setMuted(!this._muted); }

  playDrop(row = 5) {
    this._play(ctx => {
      const t = ctx.currentTime, freq = 220 - row * 16.7;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(this._master); o.start(t); o.stop(t + 0.2);

      const bl = Math.floor(ctx.sampleRate * 0.012);
      const buf = ctx.createBuffer(1, bl, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bl; i++) d[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(), ng = ctx.createGain(), fl = ctx.createBiquadFilter();
      fl.type = 'bandpass'; fl.frequency.value = 800; fl.Q.value = 0.8; ns.buffer = buf;
      ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      ns.connect(fl); fl.connect(ng); ng.connect(this._master); ns.start(t); ns.stop(t + 0.015);
    });
  }

  playClick() {
    this._play(ctx => {
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(400, t + 0.04);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); g.connect(this._master); o.start(t); o.stop(t + 0.06);
    });
  }

  playWin() {
    this._play(ctx => {
      const t = ctx.currentTime, notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, i) => {
        const s = t + i * 0.10, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(freq, s);
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.45, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.55);
        o.connect(g); g.connect(this._master); o.start(s); o.stop(s + 0.6);
        const o2 = ctx.createOscillator(), g2 = ctx.createGain();
        o2.type = 'sine'; o2.frequency.setValueAtTime(freq * 2, s);
        g2.gain.setValueAtTime(0, s); g2.gain.linearRampToValueAtTime(0.12, s + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
        o2.connect(g2); g2.connect(this._master); o2.start(s); o2.stop(s + 0.45);
      });
    });
  }

  playDraw() {
    this._play(ctx => {
      const t = ctx.currentTime;
      [[220, 0], [220, 8]].forEach(([f, dv]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f + dv, t);
        o.frequency.exponentialRampToValueAtTime((f + dv) * 0.75, t + 0.6);
        g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        o.connect(g); g.connect(this._master); o.start(t); o.stop(t + 0.7);
      });
    });
  }

  playModalOpen() {
    this._play(ctx => {
      const t = ctx.currentTime;
      const bl = Math.floor(ctx.sampleRate * 0.35);
      const buf = ctx.createBuffer(1, bl, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bl; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; fl.type = 'bandpass';
      fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
      fl.Q.value = 1.2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      src.connect(fl); fl.connect(g); g.connect(this._master); src.start(t); src.stop(t + 0.38);
    });
  }

  _ensureContext() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._ready = true; return Promise.resolve(); }
      this._ctx = new AC();
      this._master = this._ctx.createGain();
      this._master.gain.value = this._muted ? 0 : 1;
      this._master.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'running') { this._ready = true; return Promise.resolve(); }
    return this._ctx.resume().then(() => {
      this._ready = true; this._resumeQ.forEach(fn => fn()); this._resumeQ = [];
    }).catch(() => { this._ready = true; });
  }

  _play(fn) {
    if (!this._ctx || this._ctx.state !== 'running') {
      this._resumeQ.push(() => { if (this._ctx) try { fn(this._ctx); } catch (_) {} });
      this._ensureContext();
      return;
    }
    try { fn(this._ctx); } catch (_) {}
  }
}

/* ─────────────────────────────────────────────────────────────
   STATS MANAGER
───────────────────────────────────────────────────────────── */
class StatsManager {
  static KEY      = 'c4-stats';
  static MAX_HIST = 50;

  constructor() { this._data = this._load(); }

  get totalMatches() { return this._data.totalMatches; }
  get p1Wins()       { return this._data.p1Wins; }
  get p2Wins()       { return this._data.p2Wins; }
  get draws()        { return this._data.draws; }
  get streak()       { return this._data.streak; }
  get streakPlayer() { return this._data.streakPlayer; }
  get history()      { return this._data.history; }

  winRate(p) {
    if (!this._data.totalMatches) return 0;
    const wins = p === P1 ? this._data.p1Wins : this._data.p2Wins;
    return Math.round((wins / this._data.totalMatches) * 100);
  }

  recordResult(winner, moves) {
    const d = this._data;
    d.totalMatches++;
    if (winner === P1)       d.p1Wins++;
    else if (winner === P2)  d.p2Wins++;
    else                     d.draws++;

    if (winner === 'draw') {
      d.streak = 0; d.streakPlayer = null;
    } else if (winner === d.streakPlayer) {
      d.streak++;
    } else {
      d.streak = 1; d.streakPlayer = winner;
    }

    d.history.unshift({ winner, moves, ts: Date.now() });
    if (d.history.length > StatsManager.MAX_HIST) d.history.length = StatsManager.MAX_HIST;
    this._save();
  }

  clear() { this._data = this._blank(); this._save(); }

  _blank() {
    return { totalMatches: 0, p1Wins: 0, p2Wins: 0, draws: 0, streak: 0, streakPlayer: null, history: [] };
  }

  _load() {
    try {
      const raw = localStorage.getItem(StatsManager.KEY);
      if (!raw) return this._blank();
      const p = JSON.parse(raw);
      const b = this._blank();
      b.totalMatches = typeof p.totalMatches === 'number' ? p.totalMatches : 0;
      b.p1Wins       = typeof p.p1Wins       === 'number' ? p.p1Wins       : 0;
      b.p2Wins       = typeof p.p2Wins       === 'number' ? p.p2Wins       : 0;
      b.draws        = typeof p.draws        === 'number' ? p.draws        : 0;
      b.streak       = typeof p.streak       === 'number' ? p.streak       : 0;
      b.streakPlayer = p.streakPlayer ?? null;
      b.history      = Array.isArray(p.history) ? p.history.slice(0, StatsManager.MAX_HIST) : [];
      return b;
    } catch (_) { return this._blank(); }
  }

  _save() {
    try { localStorage.setItem(StatsManager.KEY, JSON.stringify(this._data)); } catch (_) {}
  }
}

/* ─────────────────────────────────────────────────────────────
   STATS MODAL
───────────────────────────────────────────────────────────── */
class StatsModal {
  /**
   * @param {StatsManager}    stats
   * @param {SoundEngine}     sound
   * @param {()=>void}        onNewGame  — called when "View Stats" closes to new game
   */
  constructor(stats, sound, onNewGame) {
    this._stats     = stats;
    this._sound     = sound;
    this._onNewGame = onNewGame;
    this._open      = false;
    this._rafs      = [];   // tracked RAF ids for cancellation

    // Cache DOM refs
    this.$modal      = document.getElementById('stats-modal');
    this.$ringP1     = document.getElementById('ring-p1');
    this.$ringP2     = document.getElementById('ring-p2');
    this.$ringDraw   = document.getElementById('ring-draw');
    this.$ringTotal  = document.getElementById('ring-total');
    this.$statP1     = document.getElementById('stat-p1-wins');
    this.$statP2     = document.getElementById('stat-p2-wins');
    this.$statDraws  = document.getElementById('stat-draws');
    this.$statStreak = document.getElementById('stat-streak');
    this.$streakLbl  = document.getElementById('stat-streak-label');
    this.$rateBarP1  = document.getElementById('rate-bar-p1');
    this.$rateBarP2  = document.getElementById('rate-bar-p2');
    this.$ratePctP1  = document.getElementById('rate-pct-p1');
    this.$ratePctP2  = document.getElementById('rate-pct-p2');
    this.$histList   = document.getElementById('history-list');
    this.$histEmpty  = document.getElementById('history-empty');
    this.$histCount  = document.getElementById('history-count');

    this._bindButtons();
  }

  isOpen() { return this._open; }

  show() {
    if (this._open) return;
    this._open = true;
    this._render();
    this.$modal.classList.remove('hidden');
    // Focus the close button for keyboard accessibility
    document.getElementById('btn-stats-close')?.focus();
  }

  hide() {
    if (!this._open) return;
    this._open = false;
    // Cancel any running count-up animations
    for (const id of this._rafs) cancelAnimationFrame(id);
    this._rafs = [];
    this.$modal.classList.add('hidden');
  }

  _bindButtons() {
    document.getElementById('btn-stats')?.addEventListener('click', () => {
      this._sound.resume(); this._sound.playClick();
      this._open ? this.hide() : this.show();
    });

    document.getElementById('btn-stats-close')?.addEventListener('click', () => {
      this._sound.playClick(); this.hide();
    });

    document.getElementById('btn-stats-done')?.addEventListener('click', () => {
      this._sound.playClick(); this.hide();
    });

    document.getElementById('btn-clear-stats')?.addEventListener('click', () => {
      this._sound.playClick();
      this._stats.clear();
      this._render();
    });

    // Win modal → Statistics button
    document.getElementById('btn-view-stats')?.addEventListener('click', () => {
      this._sound.resume(); this._sound.playClick();
      this.show();
    });

    // Backdrop click
    this.$modal?.addEventListener('click', e => {
      if (e.target === e.currentTarget) this.hide();
    });
  }

  _render() {
    const s = this._stats;
    const total = s.totalMatches;

    // Ring chart
    const CIRC = 2 * Math.PI * 50; // r=50
    const p1Frac    = total ? s.p1Wins / total : 0;
    const p2Frac    = total ? s.p2Wins / total : 0;
    const drawFrac  = total ? s.draws  / total : 0;
    const p1Dash    = p1Frac   * CIRC;
    const p2Dash    = p2Frac   * CIRC;
    const drawDash  = drawFrac * CIRC;
    const p1Offset  = 0;
    const p2Offset  = -(p1Dash);
    const drawOffset = -(p1Dash + p2Dash);

    this.$ringP1.style.strokeDasharray  = `${p1Dash} ${CIRC}`;
    this.$ringP1.style.strokeDashoffset = p1Offset;
    this.$ringP2.style.strokeDasharray  = `${p2Dash} ${CIRC}`;
    this.$ringP2.style.strokeDashoffset = p2Offset;
    this.$ringDraw.style.strokeDasharray  = `${drawDash} ${CIRC}`;
    this.$ringDraw.style.strokeDashoffset = drawOffset;

    // Animated count-up for tiles
    this._countUp(this.$ringTotal,  0, total,    800);
    this._countUp(this.$statP1,     0, s.p1Wins, 700);
    this._countUp(this.$statP2,     0, s.p2Wins, 700);
    this._countUp(this.$statDraws,  0, s.draws,  700);
    this._countUp(this.$statStreak, 0, s.streak, 600);

    // Streak label
    if (s.streak > 0 && s.streakPlayer) {
      this.$streakLbl.textContent = `P${s.streakPlayer} STREAK`;
    } else {
      this.$streakLbl.textContent = 'STREAK';
    }

    // Win-rate bars
    const r1 = s.winRate(P1), r2 = s.winRate(P2);
    this.$rateBarP1.style.width = `${r1}%`;
    this.$rateBarP2.style.width = `${r2}%`;
    this.$ratePctP1.textContent = `${r1}%`;
    this.$ratePctP2.textContent = `${r2}%`;

    // History
    this._renderHistory();
  }

  /**
   * Animates a number from start to end over duration ms.
   * Tracks the RAF id so it can be cancelled on hide().
   */
  _countUp($el, start, end, duration) {
    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      $el.textContent = Math.round(start + (end - start) * progress);
      if (progress < 1) {
        const id = requestAnimationFrame(step);
        this._rafs.push(id);
      }
    };
    const id = requestAnimationFrame(step);
    this._rafs.push(id);
  }

  _renderHistory() {
    const history = this._stats.history;
    const hasHistory = Array.isArray(history) && history.length > 0;

    this.$histEmpty.classList.toggle('hidden', hasHistory);
    this.$histCount.textContent = `${this._stats.totalMatches} match${this._stats.totalMatches !== 1 ? 'es' : ''}`;

    if (!hasHistory) { this.$histList.innerHTML = ''; return; }

    const frag = document.createDocumentFragment();
    history.forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      const isDraw   = entry.winner === 'draw';
      const colorKey = isDraw ? 'draw' : PLAYER[entry.winner]?.color ?? 'draw';
      const label    = isDraw ? 'Draw' : `${PLAYER[entry.winner]?.name ?? '?'} won`;
      const date     = new Date(entry.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      li.innerHTML = `
        <span class="hist-num">#${this._stats.totalMatches - idx}</span>
        <span class="hist-dot hist-dot-${colorKey}" aria-hidden="true"></span>
        <span class="hist-result">${label}</span>
        <span class="hist-moves">${entry.moves} moves</span>
        <span class="hist-date">${date}</span>
      `;
      frag.appendChild(li);
    });
    this.$histList.innerHTML = '';
    this.$histList.appendChild(frag);
  }
}

/* ─────────────────────────────────────────────────────────────
   THEME MANAGER
───────────────────────────────────────────────────────────── */
const ThemeManager = (() => {
  const STORAGE_KEY = 'c4-theme';
  const ROOT        = document.documentElement;
  const META        = document.getElementById('meta-theme-color');

  const THEME_META = {
    night: '#0a0a1a',
    day:   '#eef2ff',
  };

  let _current = 'night';

  function _apply(theme, animate = false) {
    _current = theme;
    ROOT.setAttribute('data-theme', theme);
    if (META) META.content = THEME_META[theme] ?? THEME_META.night;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}

    const $btn = document.getElementById('btn-theme');
    if ($btn) {
      $btn.setAttribute('aria-label', theme === 'night' ? 'Switch to day theme' : 'Switch to night theme');
      if (animate) _ripple($btn);
    }
  }

  function _ripple($btn) {
    const r = document.createElement('span');
    r.className = 'theme-ripple';
    $btn.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  }

  return {
    init() {
      // Priority: localStorage → OS preference → default night
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = saved ?? (prefersDark ? 'night' : 'day');
      _apply(theme, false);

      // Theme toggle button
      document.getElementById('btn-theme')?.addEventListener('click', () => {
        ThemeManager.toggle();
      });

      // Listen for OS preference changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        // Only follow OS if user hasn't manually set a preference
        let hasPref = false;
        try { hasPref = localStorage.getItem(STORAGE_KEY) !== null; } catch (_) {}
        if (!hasPref) _apply(e.matches ? 'night' : 'day', false);
      });
    },

    toggle() {
      _apply(_current === 'night' ? 'day' : 'night', true);
    },

    get current() { return _current; },
  };
})();

/* ─────────────────────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(err => console.error('[Connect4] Init error:', err));
});
