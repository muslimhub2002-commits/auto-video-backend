export const SAVED_SEQUENCE_SCENE_TABS = [
  'image',
  'video',
  'text',
  'overlay',
] as const;

export const SAVED_SEQUENCE_IMAGE_EFFECTS_MODES = [
  'quick',
  'detailed',
] as const;

export const SAVED_SEQUENCE_TRANSITIONS = [
  'none',
  'glitch',
  'whip',
  'flash',
  'fade',
  'chromaLeak',
  'impactZoom',
  'slicePush',
  'irisReveal',
  'echoStutter',
  'tiltSnap',
] as const;

export const SAVED_SEQUENCE_VISUAL_EFFECTS = [
  'none',
  'colorGrading',
  'animatedLighting',
  'glassSubtle',
  'glassReflections',
  'glassStrong',
] as const;

export const SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS = [
  'default',
  'slowZoomIn',
  'slowZoomOut',
  'diagonalDrift',
  'cinematicPan',
  'focusShift',
  'parallaxMotion',
  'shakeMicroMotion',
  'splitMotion',
  'rotationDrift',
] as const;

export const SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS = [
  'popInBounceHook',
  'slideCutFast',
  'typewriter',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
  'softRiseFade',
  'centerWipeReveal',
  'trackingSnapHook',
] as const;

export const SAVED_SEQUENCE_VIDEO_GENERATION_MODES = [
  'frames',
  'text',
  'referenceImage',
] as const;