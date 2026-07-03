import assert from 'node:assert/strict';
import test from 'node:test';
import { TimelineManager } from '../source/application/timeline/timeline-manager.js';
import { TimelineView } from '../source/ui/timeline.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';
import { upsertAnimationClipBoneKeyframe } from '../source/infrastructure/animation/gltf-animation.js';

const model = {
  bones: [
    { name: 'Root' },
    { name: 'Arm' }
  ],
  morphs: [],
  displayFrames: [
    {
      name: 'Upper',
      specialFlag: 0,
      frames: [
        { type: 0, index: 1 }
      ]
    }
  ]
};

const firstModel = {
  bones: [
    { name: 'Root' },
    { name: 'Arm' }
  ],
  morphs: [],
  displayFrames: [
    {
      name: 'Upper',
      specialFlag: 0,
      frames: [
        { type: 0, index: 1 }
      ]
    }
  ]
};

const secondModel = {
  bones: [
    { name: 'Root' },
    { name: 'Leg' }
  ],
  morphs: [],
  displayFrames: [
    {
      name: 'Upper',
      specialFlag: 0,
      frames: [
        { type: 0, index: 1 }
      ]
    }
  ]
};

function createNoopContext() {
  return {
    beginPath() {},
    closePath() {},
    clearRect() {},
    fill() {},
    fillRect() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    stroke() {},
    arc() {}
  };
}

function createFakeElement() {
  return {
    addEventListener() {},
    appendChild() {},
    classList: {
      add() {}
    },
    style: {},
    textContent: '',
    title: '',
    innerHTML: '',
  };
}

function createFakeCanvas() {
  const element = createFakeElement();
  element.width = 0;
  element.height = 0;
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  element.getContext = () => createNoopContext();
  return element;
}

function installFakeDom() {
  const elements = new Map([
    ['timeline-panel', createFakeElement()],
    ['timeline-track-list', createFakeElement()],
    ['timeline-scroll', createFakeElement()],
    ['timeline-spacer', createFakeElement()],
    ['timeline-canvas', createFakeCanvas()],
    ['timeline-header-canvas', createFakeCanvas()],
    ['timeline-header-spacer', createFakeElement()],
    ['timeline-frame-indicator', createFakeElement()],
    ['timeline-range-selection-overlay', createFakeElement()],
    ['timeline-zoom-in', createFakeElement()],
    ['timeline-zoom-out', createFakeElement()],
    ['timeline-header', createFakeElement()],
  ]);

  const scrollEl = elements.get('timeline-scroll');
  scrollEl.clientWidth = 400;
  scrollEl.clientHeight = 240;
  scrollEl.scrollLeft = 0;
  scrollEl.scrollTop = 0;

  const document = {
    createElement: () => createFakeElement(),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    }
  };

  const window = {
    addEventListener() {}
  };

  class FakeResizeObserver {
    observe() {}
    disconnect() {}
  }

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    ResizeObserver: globalThis.ResizeObserver,
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.ResizeObserver = FakeResizeObserver;

  return () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.ResizeObserver = previous.ResizeObserver;
  };
}

test('bone selection does not auto-expand its display frame group', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();

    view.setSource(null, model);
    assert.equal(view.collapsedTrackIds.has('display-frame:0:Upper'), true);

    view.setSelectedTrackByName('Arm');

    assert.equal(view.selectedTrackId, 'bone:Arm');
    assert.equal(view.collapsedTrackIds.has('display-frame:0:Upper'), true);
  } finally {
    restore();
  }
});

test('switching to a second model keeps its display frames collapsed', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const timelineView = new TimelineView();
    const modelManager = {
      instances: [
        { model: firstModel, vmd: null },
        { model: secondModel, vmd: null }
      ]
    };
    const selection = { activeInstanceIndex: 0 };
    const manager = new TimelineManager({
      modelManager,
      selection,
      timelineView,
      interpolationPanel: null,
      vmdManager: null,
      refreshScene() {},
      updateVmdListUI() {},
    });

    manager.setActiveInstance(0);
    timelineView.toggleTrackCollapse(timelineView.findTrackById('display-frame:0:Upper'));
    assert.equal(timelineView.collapsedTrackIds.has('display-frame:0:Upper'), false);

    selection.activeInstanceIndex = 1;
    manager.setActiveInstance(1);

    assert.equal(timelineView.findTrackById('display-frame:0:Upper') !== null, true);
    assert.equal(timelineView.collapsedTrackIds.has('display-frame:0:Upper'), true);
  } finally {
    restore();
  }
});

test('clicking a keyframe selects it instead of starting a playhead drag', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, model, { collapseState: [] });

    const track = view.findTrackByName('Arm');
    assert.ok(track);
    const keyframe = track.keyframes[0];

    let selectedTrack = null;
    let selectedKeyframe = null;
    view.onKeyframeSelected = (nextTrack, nextKeyframe) => {
      selectedTrack = nextTrack;
      selectedKeyframe = nextKeyframe;
    };

    view.handleCanvasMouseDown({ clientX: 24, clientY: 36 });

    assert.equal(view.isDraggingPlayhead, false);
    assert.equal(view.selectedTrackId, 'bone:Arm');
    assert.equal(view.selectedKeyframe, keyframe);
    assert.equal(selectedTrack, track);
    assert.equal(selectedKeyframe, keyframe);
  } finally {
    restore();
  }
});

test('shift-click toggles leaf keyframes into the multi-selection', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 20,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, groupedModel, { collapseState: [] });

    const armTrack = view.findTrackByName('Arm');
    const legTrack = view.findTrackByName('Leg');
    assert.ok(armTrack);
    assert.ok(legTrack);

    view.handleCanvasMouseDown({ clientX: 24, clientY: 36 });
    assert.equal(view.selectedKeyframeEntries.length, 1);
    assert.equal(view.selectedTrackId, 'bone:Arm');

    view.handleCanvasMouseDown({ clientX: 40, clientY: 60, shiftKey: true });
    assert.equal(view.selectedKeyframeEntries.length, 2);
    assert.deepEqual(
      view.selectedKeyframeEntries.map((entry) => entry.track.id).sort(),
      ['bone:Arm', 'bone:Leg']
    );
    assert.equal(view.selectedTrackId, 'bone:Leg');

    view.handleCanvasMouseDown({ clientX: 24, clientY: 36, shiftKey: true });
    assert.equal(view.selectedKeyframeEntries.length, 1);
    assert.equal(view.selectedKeyframeEntries[0].track.id, 'bone:Leg');
    assert.equal(view.selectedTrackId, 'bone:Leg');
  } finally {
    restore();
  }
});

test('clicking empty space in the top band starts a playhead drag without clearing selection', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, model, { collapseState: [] });

    const track = view.findTrackByName('Arm');
    assert.ok(track);
    const keyframe = track.keyframes[0];
    view._selectTrack(track, keyframe, false);

    let frameChanged = null;
    view.onFrameChanged = (frame) => {
      frameChanged = frame;
    };

    view.handleCanvasMouseDown({ clientX: 100, clientY: 8 });

    assert.equal(view.isDraggingPlayhead, true);
    assert.equal(Math.round(view.currentFrame), 50);
    assert.equal(frameChanged, 50);
    assert.equal(view.selectedTrackId, 'bone:Arm');
    assert.equal(view.selectedKeyframe, keyframe);
  } finally {
    restore();
  }
});

test('clicking empty space below the top band does not change selection', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, model, { collapseState: [] });

    const track = view.findTrackByName('Arm');
    assert.ok(track);
    const keyframe = track.keyframes[0];
    view._selectTrack(track, keyframe, false);
    view.setCurrentFrame(0);

    view.handleCanvasMouseDown({ clientX: 100, clientY: 60 });

    assert.equal(view.isDraggingPlayhead, false);
    assert.equal(view.currentFrame, 0);
    assert.equal(view.selectedTrackId, 'bone:Arm');
    assert.equal(view.selectedKeyframe, keyframe);
  } finally {
    restore();
  }
});

test('clicking a display-frame key selects every keyframe at that frame in the group', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Arm',
          frameNum: 20,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, groupedModel, { collapseState: [] });

    const groupTrack = view.findTrackById('display-frame:0:Upper');
    assert.ok(groupTrack);

    view.handleCanvasMouseDown({ clientX: 24, clientY: 12 });

    assert.equal(view.selectedTrackId, 'display-frame:0:Upper');
    assert.equal(view.selectedKeyframeEntries.length, 2);
    assert.deepEqual(
      view.selectedKeyframeEntries.map((entry) => entry.track.id).sort(),
      ['bone:Arm', 'bone:Leg']
    );
    assert.equal(view.selectedKeyframeEntries.every((entry) => entry.keyframe.frame === 12), true);
  } finally {
    restore();
  }
});

test('dragging a range selects every keyframe inside the marquee and shows the overlay', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Arm',
          frameNum: 20,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, groupedModel, { collapseState: [] });

    const overlay = document.getElementById('timeline-range-selection-overlay');
    view.handleCanvasMouseDown({ clientX: 8, clientY: 32, button: 0 });
    view.handleMouseMove({ clientX: 30, clientY: 68 });

    assert.equal(view.isDraggingRangeSelection, true);
    assert.equal(overlay.style.display, 'block');
    assert.equal(overlay.style.left, '8px');
    assert.equal(overlay.style.top, '32px');
    assert.equal(overlay.style.width, '22px');
    assert.equal(overlay.style.height, '36px');

    view.handleMouseUp();

    assert.equal(view.isDraggingRangeSelection, false);
    assert.equal(overlay.style.display, 'none');
    assert.equal(view.selectedKeyframeEntries.length, 2);
    assert.deepEqual(
      view.selectedKeyframeEntries.map((entry) => entry.track.id).sort(),
      ['bone:Arm', 'bone:Leg']
    );
  } finally {
    restore();
  }
});

test('range selection overlay stays aligned when the timeline is scrolled', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const modelWithScroll = {
      bones: [
        { name: 'Root' },
        { name: 'Helper' },
        { name: 'Arm' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 0 },
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 30,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, modelWithScroll, { collapseState: [] });
    view.pixelsPerFrame = 4;
    view.resize();
    view.scrollEl.scrollLeft = 80;
    view.scrollEl.scrollTop = 24;

    const overlay = document.getElementById('timeline-range-selection-overlay');
    view.handleCanvasMouseDown({ clientX: 18, clientY: 54, button: 0 });
    view.handleMouseMove({ clientX: 58, clientY: 66 });

    assert.equal(overlay.style.display, 'block');
    assert.equal(overlay.style.left, '98px');
    assert.equal(overlay.style.top, '78px');
    assert.equal(overlay.style.width, '40px');
    assert.equal(overlay.style.height, '12px');

    view.handleMouseUp();

    assert.equal(overlay.style.display, 'none');
    assert.equal(view.selectedKeyframeEntries.length, 1);
    assert.equal(view.selectedKeyframeEntries[0].track.id, 'bone:Arm');
    assert.equal(view.selectedKeyframeEntries[0].keyframe.frame, 30);
  } finally {
    restore();
  }
});

test('track list height matches the canvas viewport height', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const timelineScroll = document.getElementById('timeline-scroll');

    timelineScroll.clientHeight = 240;
    view.resize();

    assert.equal(view.trackListEl.style.height, '240px');

    timelineScroll.clientHeight = 208;
    view.resize();

    assert.equal(view.trackListEl.style.height, '208px');
  } finally {
    restore();
  }
});

test('shift-dragging adds range-selected keyframes to the current selection', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, groupedModel, { collapseState: [] });

    const armTrack = view.findTrackByName('Arm');
    assert.ok(armTrack);
    view._selectTrack(armTrack, armTrack.keyframes[0], false);

    view.handleCanvasMouseDown({ clientX: 8, clientY: 32, button: 0, shiftKey: true });
    view.handleMouseMove({ clientX: 30, clientY: 68, shiftKey: true });
    view.handleMouseUp();

    assert.equal(view.selectedKeyframeEntries.length, 2);
    assert.deepEqual(
      view.selectedKeyframeEntries.map((entry) => entry.track.id).sort(),
      ['bone:Arm', 'bone:Leg']
    );
  } finally {
    restore();
  }
});

test('shift-clicking a display-frame key toggles the whole frame group', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };

    view.setSource(vmd, groupedModel, { collapseState: [] });

    view.handleCanvasMouseDown({ clientX: 24, clientY: 12 });
    assert.equal(view.selectedKeyframeEntries.length, 2);

    view.handleCanvasMouseDown({ clientX: 24, clientY: 12, shiftKey: true });
    assert.equal(view.selectedKeyframeEntries.length, 0);
    assert.equal(view.selectedTrackId, null);
  } finally {
    restore();
  }
});

test('deleteSelectedKeyframes removes the selected keyframes from the active VMD', async () => {
  const restore = installFakeDom();
  try {
    const { TimelineView } = await import('../source/ui/timeline.js');
    const { TimelineManager } = await import('../source/application/timeline/timeline-manager.js');
    const view = new TimelineView();
    const groupedModel = {
      bones: [
        { name: 'Root' },
        { name: 'Arm' },
        { name: 'Leg' }
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 },
            { type: 0, index: 2 }
          ]
        }
      ]
    };
    const vmd = {
      boneKeyframes: [
        {
          boneName: 'Arm',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Leg',
          frameNum: 12,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        },
        {
          boneName: 'Arm',
          frameNum: 20,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1]
        }
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: []
    };
    let seekCount = 0;
    let refreshCount = 0;
    const modelManager = {
      instances: [
        {
          model: groupedModel,
          vmd,
          animationController: {
            currentFrame: 12,
            setVmd(nextVmd) {
              this.vmd = nextVmd;
            },
            seek(frame) {
              this.currentFrame = frame;
              seekCount += 1;
            }
          }
        }
      ]
    };
    const selection = { activeInstanceIndex: 0 };
    const manager = new TimelineManager({
      modelManager,
      selection,
      timelineView: view,
      interpolationPanel: null,
      vmdManager: null,
      refreshScene() {
        refreshCount += 1;
      },
      updateVmdListUI() {},
    });
    manager.currentFrame = 12;

    view.setSource(vmd, groupedModel, { collapseState: [] });
    view.handleCanvasMouseDown({ clientX: 24, clientY: 12 });

    assert.equal(view.selectedKeyframeEntries.length, 2);

    const deleted = manager.deleteSelectedKeyframes();

    assert.equal(deleted, true);
    assert.equal(view.selectedKeyframeEntries.length, 0);
    assert.equal(view.selectedTrackId, null);
    assert.deepEqual(
      vmd.boneKeyframes.map((keyframe) => keyframe.frameNum),
      [20]
    );
    assert.equal(modelManager.instances[0].animationController.currentFrame, 12);
    assert.equal(seekCount, 0);
    assert.equal(refreshCount, 1);
  } finally {
    restore();
  }
});

test('deleteSelectedKeyframes removes the selected keyframes from a VRM VRMA clip', async () => {
  const restore = installFakeDom();
  try {
    const view = new TimelineView();
    const clip = createEmptyAnimationClip({
      name: 'VrmaEdit',
      timelineFps: 30,
      metadata: {
        sourceFormat: 'vrma',
        vrmAnimation: {
          humanBones: {
            hips: 'hips',
          },
          expressions: {},
        },
      },
    });
    upsertAnimationClipBoneKeyframe(clip, 'hips', 12, {
      translation: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    });

    const model = {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: '全ての親' },
        { name: 'Hips' },
      ],
      morphs: [],
      displayFrames: [
        {
          name: 'Upper',
          specialFlag: 0,
          frames: [
            { type: 0, index: 1 }
          ]
        }
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    };
    let refreshCount = 0;
    const instance = {
      model,
      scene: {},
      morphController: {
        resetManualWeight() {},
      },
      animationController: {
        currentFrame: 12,
        setAnimationClip(nextClip) {
          this.clip = nextClip;
        },
        setVmd() {
          throw new Error('setVmd should not be called for VRMA editing');
        },
        setBoneMappings() {},
      },
      vmd: null,
      vmdName: null,
      animationSource: {
        kind: 'vrma',
        name: 'VrmaEdit.vrma',
        clip,
      },
      animationSourceName: 'VrmaEdit.vrma',
      animationSourceType: 'vrma',
      animationMappingBySourceKey: new Map(),
    };

    const manager = new TimelineManager({
      modelManager: {
        instances: [instance],
        resetManualTransform() {},
      },
      selection: {
        activeInstanceIndex: 0,
        selectedBoneIndices: [],
        activeBoneIndex: -1,
      },
      timelineView: view,
      interpolationPanel: null,
      vmdManager: {
        vmds: new Map(),
        vrmas: new Map([['VrmaEdit.vrma', instance.animationSource]]),
      },
      refreshScene() {
        refreshCount += 1;
      },
      updateVmdListUI() {},
    });
    manager.currentFrame = 12;

    view.setSource(clip, model, { collapseState: [] });
    const track = view.findTrackByName('Hips');
    assert.ok(track);
    assert.equal(track.keyframes.length, 1);
    view.state.selectKeyframes(track, [{ track, keyframe: track.keyframes[0] }]);

    const deleted = manager.deleteSelectedKeyframes();

    assert.equal(deleted, true);
    assert.equal(view.selectedKeyframeEntries.length, 0);
    assert.equal(clip.channels.length, 0);
    assert.equal(refreshCount, 1);
  } finally {
    restore();
  }
});
