// Shared constants for Remotion composition effects/transitions.

// Linear zoom rate. Example: 0.04 means +4% scale per second.
// Set to 0 to avoid any constant “camera motion”.
export const IMAGE_ZOOM_PER_SECOND = 0.009;
export const IMAGE_SLOW_ZOOM_IN_PER_SECOND = 0.014;
export const IMAGE_SLOW_ZOOM_OUT_PER_SECOND = 0.014;
export const IMAGE_SLOW_ZOOM_OUT_START_SCALE = 1.085;
export const IMAGE_DIAGONAL_DRIFT_X_MULTIPLIER = 0.032;
export const IMAGE_DIAGONAL_DRIFT_Y_MULTIPLIER = 0.022;
export const IMAGE_CINEMATIC_PAN_X_MULTIPLIER = 0.055;
export const IMAGE_FOCUS_SHIFT_X_MULTIPLIER = 0.026;
export const IMAGE_FOCUS_SHIFT_Y_MULTIPLIER = 0.02;
export const IMAGE_PARALLAX_X_MULTIPLIER = 0.024;
export const IMAGE_PARALLAX_Y_MULTIPLIER = 0.015;
export const IMAGE_SHAKE_MICRO_X_MULTIPLIER = 0.0045;
export const IMAGE_SHAKE_MICRO_Y_MULTIPLIER = 0.0035;
export const IMAGE_SPLIT_MOTION_X_MULTIPLIER = 0.028;
export const IMAGE_SPLIT_MOTION_Y_MULTIPLIER = 0.018;
export const IMAGE_ROTATION_DRIFT_X_MULTIPLIER = 0.014;
export const IMAGE_ROTATION_DRIFT_Y_MULTIPLIER = 0.012;

// Transition window: last N frames of outgoing + first N frames of incoming.
export const GLITCH_EDGE_FRAMES = 4;

// Camera flash transition: bright flash around cut.
export const FLASH_EDGE_FRAMES = 5;

// Fade transition: fade-to-black around cut.
export const FADE_EDGE_FRAMES = 12;

// Whip-pan transition: fast pan + motion blur around cut.
export const WHIP_EDGE_FRAMES = 10;
export const WHIP_DISTANCE_MULTIPLIER = 1.15; // fraction of frame width
export const WHIP_MAX_BLUR_PX = 18;

// VR Chroma Leaks transition: RGB separation + light leak around cut.
export const CHROMA_EDGE_FRAMES = 10;
export const CHROMA_MAX_SHIFT_PX = 22;
export const CHROMA_MAX_BLUR_PX = 6;

// Impact zoom transition: fast punch-in at the cut.
export const IMPACT_ZOOM_EDGE_FRAMES = 8;
export const IMPACT_ZOOM_MAX_SCALE_DELTA = 0.18;
export const IMPACT_ZOOM_MAX_BLUR_PX = 6;

// Slice push transition: staggered split-screen push.
export const SLICE_PUSH_EDGE_FRAMES = 10;
export const SLICE_PUSH_MAX_SHIFT_MULTIPLIER = 0.22;
export const SLICE_PUSH_MAX_BLUR_PX = 12;

// Iris reveal transition: circular reveal around the center.
export const IRIS_REVEAL_EDGE_FRAMES = 18;
export const IRIS_REVEAL_MAX_RADIUS_PERCENT = 150;
export const IRIS_REVEAL_MAX_GLOW_OPACITY = 0.34;

// Echo stutter transition: ghosted motion trails around the cut.
export const ECHO_STUTTER_EDGE_FRAMES = 8;
export const ECHO_STUTTER_MAX_SHIFT_MULTIPLIER = 0.05;
export const ECHO_STUTTER_MAX_SCALE_DELTA = 0.035;
export const ECHO_STUTTER_MAX_BLUR_PX = 8;

// Tilt snap transition: fast tilt and settle.
export const TILT_SNAP_EDGE_FRAMES = 9;
export const TILT_SNAP_MAX_ROTATION_DEG = 20;
export const TILT_SNAP_MAX_SHIFT_MULTIPLIER = 0.035;
export const TILT_SNAP_MAX_SCALE_DELTA = 0.06;
export const TILT_SNAP_MAX_BLUR_PX = 8;

// Production note:
// In production (Remotion Lambda), prefer passing CDN/Cloudinary/S3 URLs via `timeline.assets`.
// If not provided, we fall back to local `staticFile()` assets in `remotion/public`.
// These defaults intentionally match the backend render pipeline's publicDir layout
// (see REMOTION_*_REL constants): audio/*, sfx/*, videos/*.
export const DEFAULT_BACKGROUND_MUSIC_SRC = 'audio/background_3.mp3';
export const DEFAULT_GLITCH_FX_URL = 'sfx/glitch.mp3';
export const DEFAULT_WHOOSH_SFX_URL = 'sfx/whoosh.mp3';
export const DEFAULT_WHOOSH_END_SFX_URL = 'sfx/whoosh-end.mp3';
export const DEFAULT_AIR_WHOOSH_SFX_URL = 'sfx/whoosh-end.mp3';
export const DEFAULT_CAMERA_CLICK_SFX_URL = 'sfx/camera_click.mp3';
// There is no dedicated chroma leak SFX file in `remotion/public/sfx` right now,
// so default to an existing whoosh to avoid silent chromaLeak transitions in local renders.
// Can be overridden via `timeline.assets.chromaLeakSfxSrc`.
export const DEFAULT_CHROMA_LEAK_SFX_URL = 'sfx/whoosh-end.mp3';
export const DEFAULT_SUSPENSE_GLITCH_SFX_URL = 'sfx/suspense-glitch.mp3';
