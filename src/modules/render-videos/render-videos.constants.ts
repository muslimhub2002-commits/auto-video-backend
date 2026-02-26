export const SUBSCRIBE_SENTENCE =
  'Please Subscribe & Help us reach out to more people';

// Shorts outro CTA: rendered using the same subscribe video clip.
export const SHORTS_CTA_SENTENCE =
  'You can watch the full video from the link in the first comment';

const normalizeSubscribeLike = (value: string) => {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ');
};

const SUBSCRIBE_SENTENCE_NORM = normalizeSubscribeLike(SUBSCRIBE_SENTENCE);
const SHORTS_CTA_SENTENCE_NORM = normalizeSubscribeLike(SHORTS_CTA_SENTENCE);

export const isSubscribeLikeSentence = (text: string) => {
  const norm = normalizeSubscribeLike(text);
  return norm === SUBSCRIBE_SENTENCE_NORM || norm === SHORTS_CTA_SENTENCE_NORM;
};

export const SUBSCRIBE_VIDEO_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768053443/subscribe_ejq4q9.mp4';

export const BACKGROUND_AUDIO_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768057652/background_ny4lml.mp3';

export const GLITCH_FX_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768057729/glitch-fx_xkpwzq.mp3';

export const CAMERA_CLICK_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768057799/camera_click_mziq08.mp3';

export const WHOOSH_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768057829/whoosh_ioio4g.mp3';

export const CHROMA_LEAK_SFX_CLOUDINARY_URL =
  'https://res.cloudinary.com/dgc1yko8i/video/upload/v1768515034/whoosh-end-384629_1_k8lth5.mp3';
