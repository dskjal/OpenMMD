import { TimelineHeadlessViewState } from '../application/timeline/timeline-headless.js';

/**
 * Timeline view and interaction handling.
 */
export class TimelineView {
  constructor() {
    this.container = document.getElementById('timeline-panel');
    this.trackListEl = document.getElementById('timeline-track-list');
    this.scrollEl = document.getElementById('timeline-scroll');
    this.spacerEl = document.getElementById('timeline-spacer');
    this.canvas = document.getElementById('timeline-canvas');
    this.headerCanvas = document.getElementById('timeline-header-canvas');
    this.headerSpacerEl = document.getElementById('timeline-header-spacer');
    this.frameIndicator = document.getElementById('timeline-frame-indicator');
    this.rangeSelectionOverlay = document.getElementById('timeline-range-selection-overlay');

    this.ctx = this.canvas.getContext('2d');
    this.headerCtx = this.headerCanvas.getContext('2d');

    if (!this.ctx || !this.headerCtx) {
      console.error('TimelineView: Failed to get 2D context from canvas');
    }

    this.state = new TimelineHeadlessViewState();
    this.currentFrame = 0;
    this.pixelsPerFrame = 2;
    this.rowHeight = 24;
    this.headerHeight = 30;
    this.playheadDragAreaHeight = this.headerHeight;
    this.isDraggingPlayhead = false;
    this.isRangeSelectionPending = false;
    this.isDraggingRangeSelection = false;
    this.rangeSelectionStart = null;
    this.rangeSelectionCurrent = null;
    this.rangeSelectionAdditive = false;
    this.rangeSelectionThreshold = 4;

    this.scrollEl.addEventListener('scroll', () => {
      this.syncScroll();
      this.render();
    });
    this.trackListEl.addEventListener('wheel', (e) => this.handleTrackListWheel(e), { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.scrollEl);

    this.headerCanvas.addEventListener('mousedown', (e) => this.handleHeaderMouseDown(e));
    this.canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', () => this.handleMouseUp());

    this.onKeyframeSelected = null;
    this.onFrameChanged = null;

    document.getElementById('timeline-zoom-in').addEventListener('click', () => {
      const oldCenterFrame = (this.scrollEl.scrollLeft + this.scrollEl.clientWidth / 2) / this.pixelsPerFrame;
      this.pixelsPerFrame = Math.min(50, this.pixelsPerFrame * 1.5);
      this.resize();
      this.scrollEl.scrollLeft = oldCenterFrame * this.pixelsPerFrame - this.scrollEl.clientWidth / 2;
    });
    document.getElementById('timeline-zoom-out').addEventListener('click', () => {
      const oldCenterFrame = (this.scrollEl.scrollLeft + this.scrollEl.clientWidth / 2) / this.pixelsPerFrame;
      this.pixelsPerFrame = Math.max(0.1, this.pixelsPerFrame / 1.5);
      this.resize();
      this.scrollEl.scrollLeft = oldCenterFrame * this.pixelsPerFrame - this.scrollEl.clientWidth / 2;
    });

    this.resize();
  }

  get tracks() {
    return this.state.tracks;
  }

  set tracks(value) {
    this.state.tracks = value;
  }

  get visibleTrackEntries() {
    return this.state.visibleTrackEntries;
  }

  set visibleTrackEntries(value) {
    this.state.visibleTrackEntries = value;
  }

  get maxFrame() {
    return this.state.maxFrame;
  }

  set maxFrame(value) {
    this.state.maxFrame = value;
  }

  get collapsedTrackIds() {
    return this.state.collapsedTrackIds;
  }

  set collapsedTrackIds(value) {
    this.state.collapsedTrackIds = value;
  }

  get selectedTrackId() {
    return this.state.selectedTrackId;
  }

  set selectedTrackId(value) {
    this.state.selectedTrackId = value;
  }

  get selectedTrack() {
    return this.state.selectedTrack;
  }

  set selectedTrack(value) {
    this.state.selectedTrack = value;
  }

  get selectedKeyframe() {
    return this.state.selectedKeyframe;
  }

  set selectedKeyframe(value) {
    this.state.selectedKeyframe = value;
  }

  get selectedKeyframeEntries() {
    return this.state.selectedKeyframeEntries;
  }

  set selectedKeyframeEntries(value) {
    this.state.selectedKeyframeEntries = value;
  }

  /**
   * Sets the source VMD and model data.
   * @param {object} vmd
   * @param {object} model
   * @param {object} [options]
   * @param {Iterable<string>|string[]} [options.collapseState]
   */
  setSource(vmd, model, options = {}) {
    this.state.setSource(vmd, model, options);
    this.updateTrackListUI();
    this.resize();
  }

  /**
   * Sets the current frame and updates the display.
   * @param {number} frame
   */
  setCurrentFrame(frame) {
    this.currentFrame = frame;
    this.frameIndicator.textContent = `Frame: ${Math.floor(frame)}`;
    this.render();
  }

  scrollToFrame(frame) {
    const x = frame * this.pixelsPerFrame;
    if (x < this.scrollEl.scrollLeft || x > this.scrollEl.scrollLeft + this.scrollEl.clientWidth) {
      this.scrollEl.scrollLeft = x - this.scrollEl.clientWidth / 2;
    }
  }

  /**
   * Returns the current collapse state as an array of track ids.
   * @returns {string[]}
   */
  getCollapseState() {
    return this.state.getCollapseState();
  }

  /**
   * Restores the collapse state and redraws the timeline.
   * @param {Iterable<string>|string[]} collapseState
   */
  setCollapseState(collapseState) {
    this.state.setCollapseState(collapseState);
    this.updateTrackListUI();
    this.resize();
  }

  /**
   * Selects a track by label.
   * @param {string} name
   * @param {object} [options]
   * @param {boolean} [options.expandAncestors=false]
   */
  setSelectedTrackByName(name, options = {}) {
    const changed = this.state.setSelectedTrackByName(name, options);
    if (!changed) {
      return;
    }
    this.updateTrackListUI();
    this.render();
  }

  /**
   * Finds a track by id.
   * @param {string} id
   * @returns {object|null}
   */
  findTrackById(id) {
    return this.state.findTrackById(id);
  }

  /**
   * Finds a leaf track by label.
   * @param {string} name
   * @returns {object|null}
   */
  findTrackByName(name) {
    return this.state.findTrackByName(name);
  }

  /**
   * Returns visible track entries with their row depth.
   * @returns {{track: object, depth: number}[]}
   */
  getVisibleTrackEntries() {
    return this.state.getVisibleTrackEntries();
  }

  /**
   * Updates the left track list UI.
   */
  updateTrackListUI() {
    if (this._isUpdatingUI) return;
    this._isUpdatingUI = true;

    try {
      const visibleEntries = this.getVisibleTrackEntries();
      this.visibleTrackEntries = visibleEntries;
      this.trackListEl.innerHTML = '';

      visibleEntries.forEach(({ track, depth }) => {
        const div = document.createElement('div');
        div.className = 'timeline-track-name';

        if (track.category === 'header') {
          div.classList.add('timeline-track-category');
          div.classList.add('timeline-track-group');
        }
        if (depth > 0) {
          div.classList.add('timeline-track-child');
        }
        if (this._isTrackRowSelected(track)) {
          div.classList.add('selected');
        }

        const toggle = document.createElement('span');
        toggle.className = 'timeline-track-toggle';
        if (track.category === 'header' && (track.children || []).length > 0) {
          toggle.textContent = this._isGroupTrackCollapsed(track) ? '+' : '-';
        } else {
          toggle.classList.add('timeline-track-toggle-empty');
          toggle.textContent = '';
        }

        const label = document.createElement('span');
        label.className = 'timeline-track-label';
        label.textContent = track.label;

        div.appendChild(toggle);
        div.appendChild(label);
        div.title = track.label;

        div.addEventListener('click', (e) => {
          if (e.target.className === 'timeline-track-toggle') {
            this.toggleTrackCollapse(track);
            return;
          }

          if (track.category === 'header') {
            this.toggleTrackCollapse(track);
            return;
          }

          this._selectTrack(track, null, true);
        });

        this.trackListEl.appendChild(div);
      });

      const spacer = document.createElement('div');
      const contentHeight = Math.max(this.scrollEl.clientHeight, visibleEntries.length * this.rowHeight);
      spacer.style.height = Math.max(0, contentHeight - visibleEntries.length * this.rowHeight) + 'px';
      this.trackListEl.appendChild(spacer);
    } finally {
      this._isUpdatingUI = false;
    }
  }

  /**
   * Synchronizes scroll positions between the track list and the timeline canvas.
   */
  syncScroll() {
    this.trackListEl.scrollTop = this.scrollEl.scrollTop;
    const header = document.getElementById('timeline-header');
    header.scrollLeft = this.scrollEl.scrollLeft;
  }

  /**
   * Forwards wheel scrolling over the label column to the main timeline scroller.
   * @param {WheelEvent} e
   */
  handleTrackListWheel(e) {
    if (e.deltaY === 0 && e.deltaX === 0) return;

    e.preventDefault();
    this.scrollEl.scrollTop += e.deltaY;
    this.scrollEl.scrollLeft += e.deltaX;
    this.syncScroll();
    this.render();
  }

  /**
   * Resizes the timeline canvases and spacers.
   */
  resize() {
    const width = this.scrollEl.clientWidth;
    const height = this.scrollEl.clientHeight;
    const visibleEntries = this.getVisibleTrackEntries();
    this.visibleTrackEntries = visibleEntries;

    const minContentWidth = (this.maxFrame + 100) * this.pixelsPerFrame;
    const totalWidth = Math.max(width, minContentWidth);
    const totalHeight = Math.max(height, visibleEntries.length * this.rowHeight);

    this.spacerEl.style.width = totalWidth + 'px';
    this.spacerEl.style.height = totalHeight + 'px';
    this.headerSpacerEl.style.width = totalWidth + 'px';
    this.trackListEl.style.alignSelf = 'start';
    this.trackListEl.style.height = height + 'px';

    this.canvas.width = width;
    this.canvas.height = height;
    this.headerCanvas.width = width;
    this.headerCanvas.height = this.headerHeight;

    this.render();
  }

  /**
   * Renders the timeline canvases.
   */
  render() {
    this.renderHeader();
    this.renderGrid();
    this.renderKeyframes();
    this.renderCurrentFrameLine();
  }

  _getLabelInterval(f) {
    const ppf = this.pixelsPerFrame;
    let interval = Math.round(60 / ppf);
    if (ppf > 25) interval = 1;
    else if (ppf > 10) interval = 5;
    else interval = Math.max(1, Math.floor(interval / 5) * 5);

    return interval;
  }

  /**
   * Renders the timeline header.
   */
  renderHeader() {
    const ctx = this.headerCtx;
    if (!ctx) return;
    const w = this.headerCanvas.width;
    const h = this.headerCanvas.height;
    const ppf = this.pixelsPerFrame;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#eee';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#999';
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';

    const scrollLeft = this.scrollEl.scrollLeft;
    const startFrame = Math.floor(scrollLeft / ppf);
    const endFrame = Math.ceil((scrollLeft + w) / ppf);

    for (let f = startFrame; f <= endFrame; f++) {
      const x = f * ppf - scrollLeft;
      const interval = this._getLabelInterval(f);

      if (f % interval === 0) {
        ctx.beginPath();
        ctx.moveTo(x, h - 15);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.fillText(f.toString(), x + 2, h - 5);
      } else if (f % 5 === 0) {
        ctx.beginPath();
        ctx.moveTo(x, h - 5);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = '#bbb';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
  }

  /**
   * Renders the background grid lines.
   */
  renderGrid() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppf = this.pixelsPerFrame;
    const rh = this.rowHeight;
    const visibleEntries = this.getVisibleTrackEntries();

    ctx.clearRect(0, 0, w, h);

    const scrollLeft = this.scrollEl.scrollLeft;
    const scrollTop = this.scrollEl.scrollTop;
    const startFrame = Math.floor(scrollLeft / ppf);
    const endFrame = Math.ceil((scrollLeft + w) / ppf);

    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (let f = startFrame; f <= endFrame; f++) {
      const interval = this._getLabelInterval(f);
      if (f % 5 === 0 || interval <= 5) {
        const x = f * ppf - scrollLeft;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = '#ddd';
    const startRow = Math.floor(scrollTop / rh);
    const endRow = Math.ceil((scrollTop + h) / rh);
    for (let i = startRow; i <= endRow && i < visibleEntries.length; i++) {
      const y = i * rh - scrollTop;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const contentBottom = visibleEntries.length * rh - scrollTop;
    if (contentBottom >= 0 && contentBottom <= h) {
      ctx.beginPath();
      ctx.moveTo(0, contentBottom);
      ctx.lineTo(w, contentBottom);
      ctx.stroke();
    }
  }

  /**
   * Renders keyframe markers.
   */
  renderKeyframes() {
    const ctx = this.ctx;
    if (!ctx) return;
    const ppf = this.pixelsPerFrame;
    const rh = this.rowHeight;
    const visibleEntries = this.getVisibleTrackEntries();

    const scrollLeft = this.scrollEl.scrollLeft;
    const scrollTop = this.scrollEl.scrollTop;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const startFrame = Math.floor(scrollLeft / ppf);
    const endFrame = Math.ceil((scrollLeft + w) / ppf);
    const startRow = Math.floor(scrollTop / rh);
    const endRow = Math.ceil((scrollTop + h) / rh);

    visibleEntries.forEach(({ track }, i) => {
      if (i < startRow || i > endRow) return;
      if (track.category === 'header') return;

      track.keyframes.forEach((kf) => {
        if (kf.frame < startFrame || kf.frame > endFrame) return;

        const x = kf.frame * ppf - scrollLeft;
        const y = i * rh + rh / 2 - scrollTop;
        const isSelected = this._isKeyframeSelected(track, kf);

        ctx.fillStyle = this.getKeyframeColor(track.category);
        if (isSelected) {
          ctx.fillStyle = '#ff00ff';
        }

        ctx.beginPath();
        if (track.category === 'bone') {
          ctx.moveTo(x, y - 4);
          ctx.lineTo(x + 4, y);
          ctx.lineTo(x, y + 4);
          ctx.lineTo(x - 4, y);
          ctx.closePath();
        } else {
          ctx.arc(x, y, 3, 0, Math.PI * 2);
        }
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    });

    visibleEntries.forEach(({ track }, i) => {
      if (i < startRow || i > endRow) return;
      if (track.category !== 'header') return;

      ctx.fillStyle = '#888';
      track.keyframes.forEach((kf) => {
        if (kf.frame < startFrame || kf.frame > endFrame) return;
        const x = kf.frame * ppf - scrollLeft;
        const y = i * rh + rh / 2 - scrollTop;
        const isSelected = this._isHeaderKeyframeSelected(track, kf);
        if (isSelected) {
          ctx.fillStyle = '#ff00ff';
        } else {
          ctx.fillStyle = '#888';
        }
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  /**
   * Handles mousedown on the header canvas.
   * @param {MouseEvent} e
   */
  handleHeaderMouseDown(e) {
    this.isDraggingPlayhead = true;
    this.updateFrameFromMouseEvent(e);
  }

  /**
   * Handles mousedown on the main timeline canvas.
   * @param {MouseEvent} e
   */
  handleCanvasMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = this._findKeyframeHit(mx, my);
    if (hit) {
      if (e.shiftKey) {
        this._toggleKeyframeEntries(hit.track, hit.entries, true);
      } else {
        this._selectKeyframes(hit.track, hit.entries, true);
      }
      return;
    }

    if (this._isCanvasTopInteractionArea(my)) {
      this.isDraggingPlayhead = true;
      this.updateFrameFromMouseEvent(e);
      return;
    }

    if (e.button !== 0) {
      return;
    }

    this.isRangeSelectionPending = true;
    this.isDraggingRangeSelection = false;
    this.rangeSelectionStart = { x: mx, y: my };
    this.rangeSelectionCurrent = { x: mx, y: my };
    this.rangeSelectionAdditive = Boolean(e.shiftKey);
    this._hideRangeSelectionOverlay();
    if (typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
  }

  /**
   * Handles mouse move events for the playhead.
   * @param {MouseEvent} e
   */
  handleMouseMove(e) {
    if (this.isDraggingPlayhead) {
      this.updateFrameFromMouseEvent(e);
      return;
    }

    if (!this.isRangeSelectionPending && !this.isDraggingRangeSelection) {
      return;
    }

    const point = this._getCanvasMousePoint(e);
    if (!point) {
      return;
    }

    this.rangeSelectionCurrent = point;

    if (!this.isDraggingRangeSelection) {
      const dx = point.x - this.rangeSelectionStart.x;
      const dy = point.y - this.rangeSelectionStart.y;
      if (Math.hypot(dx, dy) < this.rangeSelectionThreshold) {
        return;
      }
      this.isDraggingRangeSelection = true;
    }

    this._updateRangeSelectionOverlay(this.rangeSelectionStart, this.rangeSelectionCurrent);
    if (typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
  }

  /**
   * Clears dragging state and finalizes any active range selection.
   */
  handleMouseUp(e) {
    if (this.isDraggingRangeSelection) {
      const point = e ? this._getCanvasMousePoint(e) : null;
      if (point) {
        this.rangeSelectionCurrent = point;
      }
      const entries = this._collectKeyframeEntriesInRange(this.rangeSelectionStart, this.rangeSelectionCurrent);
      if (this.rangeSelectionAdditive) {
        if (entries.length > 0) {
          this._applySelectedKeyframeEntries(
            entries[0].track,
            this.selectedKeyframeEntries.concat(entries),
            true
          );
        }
      } else if (entries.length > 0) {
        this._selectKeyframes(entries[0].track, entries, true);
      } else {
        this.clearKeyframeSelection(true);
      }
    }

    this.isDraggingPlayhead = false;
    this.isRangeSelectionPending = false;
    this.isDraggingRangeSelection = false;
    this.rangeSelectionStart = null;
    this.rangeSelectionCurrent = null;
    this.rangeSelectionAdditive = false;
    this._hideRangeSelectionOverlay();
  }

  /**
   * Updates the current frame from a mouse event.
   * @param {MouseEvent} e
   */
  updateFrameFromMouseEvent(e) {
    const rect = this.headerCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const scrollLeft = this.scrollEl.scrollLeft;
    const frame = Math.max(0, (mx + scrollLeft) / this.pixelsPerFrame);
    this.setCurrentFrame(frame);
    if (this.onFrameChanged) {
      this.onFrameChanged(frame);
    }
  }

  /**
   * Returns true when the main canvas pointer is inside the playhead drag band.
   * @param {number} y
   * @returns {boolean}
   */
  _isCanvasTopInteractionArea(y) {
    return y >= 0 && y <= this.playheadDragAreaHeight;
  }

  /**
   * Returns the marker color for a track category.
   * @param {string} category
   * @returns {string}
   */
  getKeyframeColor(category) {
    switch (category) {
      case 'bone': return '#4a90e2';
      case 'morph': return '#e67e22';
      case 'camera': return '#9b59b6';
      case 'light': return '#f1c40f';
      case 'shadow': return '#34495e';
      default: return '#999';
    }
  }

  /**
   * Renders the current frame indicator.
   */
  renderCurrentFrameLine() {
    const ctx = this.ctx;
    if (!ctx) return;
    const scrollLeft = this.scrollEl.scrollLeft;
    const x = this.currentFrame * this.pixelsPerFrame - scrollLeft;

    if (x >= 0 && x <= this.canvas.width) {
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }

    const hctx = this.headerCtx;
    if (!hctx) return;
    if (x >= 0 && x <= this.headerCanvas.width) {
      hctx.strokeStyle = 'red';
      hctx.lineWidth = 2;
      hctx.beginPath();
      hctx.moveTo(x, 0);
      hctx.lineTo(x, this.headerHeight);
      hctx.stroke();
    }
  }

  /**
   * Selects one or more keyframes and optionally notifies listeners.
   * @param {object} track
   * @param {{track: object, keyframe: object}[]} entries
   * @param {boolean} notify
   */
  _selectKeyframes(track, entries, notify) {
    this.state.selectKeyframes(track, entries);
    this.updateTrackListUI();
    if (notify && this.onKeyframeSelected) {
      if (track && track.category !== 'header' && this.selectedKeyframeEntries.length === 1) {
        this.onKeyframeSelected(track, this.selectedKeyframeEntries[0].keyframe);
      } else {
        this.onKeyframeSelected(track, null);
      }
    }
    this.render();
  }

  /**
   * Backward-compatible wrapper for selecting a single keyframe.
   * @param {object} track
   * @param {object|null} keyframe
   * @param {boolean} notify
   */
  _selectTrack(track, keyframe, notify) {
    this._selectKeyframes(track, keyframe ? [{ track, keyframe }] : [], notify);
  }

  /**
   * Toggles one or more keyframes in the current selection.
   * @param {object} track
   * @param {{track: object, keyframe: object}[]} entries
   * @param {boolean} notify
   */
  _toggleKeyframeEntries(track, entries, notify) {
    const result = this.state.toggleKeyframeEntries(track, entries);
    if (!result) return;
    this._applySelectedKeyframeEntries(result.track, this.selectedKeyframeEntries, notify);
  }

  /**
   * Applies a fully resolved selection state.
   * @param {object|null} track
   * @param {{track: object, keyframe: object}[]} entries
   * @param {boolean} notify
   */
  _applySelectedKeyframeEntries(track, entries, notify) {
    this.state.applySelectedKeyframeEntries(track, entries);
    this.updateTrackListUI();
    if (notify && this.onKeyframeSelected) {
      if (track && track.category !== 'header' && this.selectedKeyframeEntries.length === 1) {
        this.onKeyframeSelected(track, this.selectedKeyframeEntries[0].keyframe);
      } else {
        this.onKeyframeSelected(track, null);
      }
    }
    this.render();
  }

  /**
   * Clears the current keyframe selection.
   * @param {boolean} [notify=false]
   */
  clearKeyframeSelection(notify = false) {
    this.state.clearKeyframeSelection();
    this.updateTrackListUI();
    if (notify && this.onKeyframeSelected) {
      this.onKeyframeSelected(null, null);
    }
    this.render();
  }

  /**
   * Returns true if a track row should be highlighted.
   * @param {object} track
   * @returns {boolean}
   */
  _isTrackRowSelected(track) {
    return this.state.isTrackRowSelected(track);
  }

  /**
   * Returns true if a keyframe is currently selected.
   * @param {object} track
   * @param {object} keyframe
   * @returns {boolean}
   */
  _isKeyframeSelected(track, keyframe) {
    return this.state.isKeyframeSelected(track, keyframe);
  }

  /**
   * Returns true if a header keyframe is selected.
   * @param {object} track
   * @param {object} keyframe
   * @returns {boolean}
   */
  _isHeaderKeyframeSelected(track, keyframe) {
    return this.state.isHeaderKeyframeSelected(track, keyframe);
  }

  /**
   * Returns true if a display frame track is collapsed.
   * @param {object} track
   * @returns {boolean}
   */
  _isGroupTrackCollapsed(track) {
    return this.state.isGroupTrackCollapsed(track);
  }

  /**
   * Expands the ancestors of a track.
   * @param {object} track
   */
  _expandAncestors(track) {
    this.state.expandAncestors(track);
  }

  /**
   * Collapses every display frame group.
   */
  _collapseAllGroups() {
    this.state.collapseAllGroups();
  }

  /**
   * Removes collapse ids that do not exist in the current track tree.
   */
  _pruneCollapsedTrackIds() {
    this.state.pruneCollapsedTrackIds();
  }

  /**
   * Normalizes collapse state input into a Set.
   * @param {Iterable<string>|string[]|null|undefined} collapseState
   * @returns {Set<string>}
   */
  _normalizeCollapseState(collapseState) {
    return this.state.normalizeCollapseState(collapseState);
  }

  /**
   * Toggles a group row between collapsed and expanded.
   * @param {object} track
   */
  toggleTrackCollapse(track) {
    if (!this.state.toggleTrackCollapse(track)) return;
    this.updateTrackListUI();
    this.resize();
  }

  /**
   * Captures the current keyframe selection as stable descriptors.
   * @returns {{trackId: string, frame: number, kind: string}[]}
   */
  _captureSelectedKeyframeEntries() {
    return this.state.captureSelectedKeyframeEntries();
  }

  /**
   * Restores selected keyframes from stable descriptors.
   * @param {{trackId: string, frame: number, kind: string}[]} selectedEntries
   * @returns {{track: object, keyframe: object}[]}
   */
  _restoreSelectedKeyframeEntries(selectedEntries) {
    return this.state.restoreSelectedKeyframeEntries(selectedEntries);
  }

  /**
   * Returns true if two selection entries point at the same keyframe.
   * @param {{track: object, keyframe: object}} entry
   * @param {object} track
   * @param {object} keyframe
   * @returns {boolean}
   */
  _isSameKeyframeEntry(entry, track, keyframe) {
    return this.state.isSameKeyframeEntry(entry, track, keyframe);
  }

  /**
   * Returns a stable key for a keyframe entry.
   * @param {object} track
   * @param {object} keyframe
   * @returns {string}
   */
  _getSelectedKeyframeEntryKey(track, keyframe) {
    return this.state.getSelectedKeyframeEntryKey(track, keyframe);
  }

  /**
   * Normalizes a list of keyframe entries and removes duplicates.
   * @param {{track: object, keyframe: object}[]|null|undefined} entries
   * @returns {{track: object, keyframe: object}[]}
   */
  _normalizeSelectedKeyframeEntries(entries) {
    return this.state.normalizeSelectedKeyframeEntries(entries);
  }

  /**
   * Returns the canvas-local mouse position for an event.
   * @param {MouseEvent} e
   * @returns {{x: number, y: number}|null}
   */
  _getCanvasMousePoint(e) {
    if (!e) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  /**
   * Updates the drag-selection overlay.
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} current
   */
  _updateRangeSelectionOverlay(start, current) {
    if (!this.rangeSelectionOverlay) {
      return;
    }

    const scrollLeft = this.scrollEl.scrollLeft;
    const scrollTop = this.scrollEl.scrollTop;
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    this.rangeSelectionOverlay.style.display = 'block';
    // The overlay lives inside the scroll container, so its coordinates must include the current scroll offset.
    this.rangeSelectionOverlay.style.left = `${left + scrollLeft}px`;
    this.rangeSelectionOverlay.style.top = `${top + scrollTop}px`;
    this.rangeSelectionOverlay.style.width = `${width}px`;
    this.rangeSelectionOverlay.style.height = `${height}px`;
  }

  /**
   * Hides the drag-selection overlay.
   */
  _hideRangeSelectionOverlay() {
    if (!this.rangeSelectionOverlay) {
      return;
    }

    this.rangeSelectionOverlay.style.display = 'none';
    this.rangeSelectionOverlay.style.left = '0px';
    this.rangeSelectionOverlay.style.top = '0px';
    this.rangeSelectionOverlay.style.width = '0px';
    this.rangeSelectionOverlay.style.height = '0px';
  }

  /**
   * Collects all keyframe entries inside the given drag range.
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} current
   * @returns {{track: object, keyframe: object}[]}
   */
  _collectKeyframeEntriesInRange(start, current) {
    return this.state.collectKeyframeEntriesInRange(start, current, {
      pixelsPerFrame: this.pixelsPerFrame,
      rowHeight: this.rowHeight,
      scrollLeft: this.scrollEl.scrollLeft,
      scrollTop: this.scrollEl.scrollTop,
    });
  }

  /**
   * Returns true when a point falls inside the drag selection with padding.
   * @param {number} x
   * @param {number} y
   * @param {number} left
   * @param {number} top
   * @param {number} right
   * @param {number} bottom
   * @param {number} padding
   * @returns {boolean}
   */
  _isPointInsideRangeSelection(x, y, left, top, right, bottom, padding) {
    return (
      x >= left - padding &&
      x <= right + padding &&
      y >= top - padding &&
      y <= bottom + padding
    );
  }

  /**
   * Finds a keyframe hit at the given canvas coordinates.
   * @param {number} mx
   * @param {number} my
   * @returns {{track: object, entries: {track: object, keyframe: object}[]}|null}
   */
  _findKeyframeHit(mx, my) {
    return this.state.findKeyframeHit(mx, my, {
      pixelsPerFrame: this.pixelsPerFrame,
      rowHeight: this.rowHeight,
      scrollLeft: this.scrollEl.scrollLeft,
      scrollTop: this.scrollEl.scrollTop,
    });
  }

  /**
   * Collects all child keyframes that exist at the given display-frame position.
   * @param {object} displayFrameTrack
   * @param {number} frame
   * @returns {{track: object, keyframe: object}[]}
   */
  _collectDisplayFrameSelection(displayFrameTrack, frame) {
    return this.state.collectDisplayFrameSelection(displayFrameTrack, frame);
  }
}
