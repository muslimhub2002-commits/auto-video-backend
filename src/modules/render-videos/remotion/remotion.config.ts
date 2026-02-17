// Remotion Lambda rendering configuration.
// Prefer the non-"TEST" env vars for production, but keep backwards compatibility.
//
// Enable Lambda rendering by setting either:
// - REMOTION_RENDER_PROVIDER=lambda
// - REMOTION_LAMBDA_TEST_MODE=true (legacy)

export const REMOTION_RENDER_PROVIDER = (
  process.env.REMOTION_RENDER_PROVIDER ?? ''
)
  .trim()
  .toLowerCase();

export const REMOTION_LAMBDA_REGION = (process.env.REMOTION_LAMBDA_REGION ??
  process.env.REMOTION_LAMBDA_TEST_REGION ??
  'us-east-1') as any;

export const REMOTION_LAMBDA_FUNCTION_NAME =
  process.env.REMOTION_LAMBDA_FUNCTION_NAME ??
  process.env.REMOTION_LAMBDA_TEST_FUNCTION_NAME ??
  '';

export const REMOTION_LAMBDA_SERVE_URL =
  process.env.REMOTION_LAMBDA_SERVE_URL ??
  process.env.REMOTION_LAMBDA_TEST_SERVE_URL ??
  '';

// Remotion publicDir relative paths (these are served via staticFile()).
export const REMOTION_VOICEOVER_REL = 'audio/voiceover.mp3';
export const REMOTION_BACKGROUND_REL = 'audio/background_3.mp3';
export const REMOTION_GLITCH_SFX_REL = 'sfx/glitch.mp3';
export const REMOTION_WHOOSH_SFX_REL = 'sfx/whoosh.mp3';
export const REMOTION_CAMERA_CLICK_SFX_REL = 'sfx/camera_click.mp3';
export const REMOTION_CHROMA_LEAK_SFX_REL = 'sfx/chroma_leak.mp3';
export const REMOTION_SUSPENSE_GLITCH_SFX_REL = 'sfx/suspense-glitch.mp3';
// Keep this aligned with the actual asset in remotion/public.
// On Windows, trying to read a non-existent/incorrect nested path can surface as EPERM.
export const REMOTION_SUBSCRIBE_VIDEO_REL = 'subscribe.mp4';

export const shouldUseRemotionLambda = () => {
  if (process.env.REMOTION_LAMBDA_TEST_MODE === 'true') return true;
  return REMOTION_RENDER_PROVIDER === 'lambda';
};
