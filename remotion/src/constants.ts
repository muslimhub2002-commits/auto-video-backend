// Shared constants for Remotion composition effects/transitions.

// Linear zoom rate. Example: 0.04 means +4% scale per second.
// Set to 0 to avoid any constant “camera motion”.
export const IMAGE_ZOOM_PER_SECOND = 0.009;

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

// Production note:
// In production (Remotion Lambda), prefer passing CDN/Cloudinary/S3 URLs via `timeline.assets`.
// If not provided, we fall back to local `staticFile()` assets in `remotion/public`.
export const DEFAULT_BACKGROUND_MUSIC_SRC = 'background_3.mp3';
export const DEFAULT_GLITCH_FX_URL = 'glitch-fx.mp3';
export const DEFAULT_WHOOSH_SFX_URL = 'whoosh.mp3';
export const DEFAULT_CAMERA_CLICK_SFX_URL = 'camera_click.mp3';
export const DEFAULT_SUSPENSE_GLITCH_SFX_URL = 'suspense-glitch.mp3';
