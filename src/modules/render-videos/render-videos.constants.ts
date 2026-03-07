export const CTA_SENTENCES_BY_LANGUAGE: Record<
  string,
  { subscribe: string; shorts: string }
> = {
  en: {
    subscribe: 'Please Subscribe & Help us reach out to more people',
    shorts: 'You can watch the full video from the link in the first comment',
  },
  ar: {
    subscribe: 'يرجى الاشتراك ومساعدتنا في الوصول إلى المزيد من الناس',
    shorts: 'يمكنك مشاهدة الفيديو الكامل من الرابط في أول تعليق',
  },
  es: {
    subscribe: 'Suscríbete y ayúdanos a llegar a más personas.',
    shorts: 'Puedes ver el video completo en el enlace del primer comentario.',
  },
  fr: {
    subscribe: 'Abonnez-vous et aidez-nous à toucher plus de personnes.',
    shorts:
      'Vous pouvez regarder la vidéo complète via le lien dans le premier commentaire.',
  },
  de: {
    subscribe:
      'Bitte abonnieren Sie und helfen Sie uns, mehr Menschen zu erreichen.',
    shorts:
      'Du kannst das vollständige Video über den Link im ersten Kommentar ansehen.',
  },
  it: {
    subscribe: 'Iscriviti e aiutaci a raggiungere più persone.',
    shorts: 'Puoi guardare il video completo dal link nel primo commento.',
  },
  pt: {
    subscribe: 'Inscreva-se e ajude-nos a alcançar mais pessoas.',
    shorts:
      'Você pode assistir ao vídeo completo pelo link no primeiro comentário.',
  },
  ru: {
    subscribe: 'Подпишитесь и помогите нам охватить больше людей.',
    shorts: 'Полное видео можно посмотреть по ссылке в первом комментарии.',
  },
  tr: {
    subscribe:
      'Lütfen abone olun ve daha fazla insana ulaşmamıza yardımcı olun.',
    shorts: 'Videonun tamamını ilk yorumdaki bağlantıdan izleyebilirsiniz.',
  },
  hi: {
    subscribe:
      'कृपया सब्सक्राइब करें और हमें अधिक लोगों तक पहुँचने में मदद करें।',
    shorts: 'पूरा वीडियो पहले कमेंट में दिए गए लिंक से देख सकते हैं।',
  },
  ur: {
    subscribe:
      'براہِ کرم سبسکرائب کریں اور ہمیں مزید لوگوں تک پہنچنے میں مدد کریں۔',
    shorts: 'آپ مکمل ویڈیو پہلے کمنٹ میں دیے گئے لنک سے دیکھ سکتے ہیں۔',
  },
  id: {
    subscribe:
      'Silakan berlangganan dan bantu kami menjangkau lebih banyak orang.',
    shorts:
      'Kamu bisa menonton video lengkapnya dari tautan di komentar pertama.',
  },
  ja: {
    subscribe:
      'チャンネル登録して、より多くの人に届けるお手伝いをお願いします。',
    shorts: 'フル動画は最初のコメントのリンクから視聴できます。',
  },
  ko: {
    subscribe: '구독해 주시고 더 많은 사람들에게 닿을 수 있도록 도와주세요.',
    shorts: '전체 영상은 첫 번째 댓글의 링크에서 시청할 수 있어요.',
  },
  'zh-CN': {
    subscribe: '请订阅并帮助我们触达更多人。',
    shorts: '你可以通过第一条评论中的链接观看完整视频。',
  },
};

export const getSubscribeSentence = (language: string) =>
  CTA_SENTENCES_BY_LANGUAGE[language]?.subscribe ??
  CTA_SENTENCES_BY_LANGUAGE.en.subscribe;

export const getShortsCtaSentence = (language: string) =>
  CTA_SENTENCES_BY_LANGUAGE[language]?.shorts ??
  CTA_SENTENCES_BY_LANGUAGE.en.shorts;

// Backwards-compatible exports (default to English)
export const SUBSCRIBE_SENTENCE = CTA_SENTENCES_BY_LANGUAGE.en.subscribe;

// Shorts outro CTA: rendered using the same subscribe video clip.
export const SHORTS_CTA_SENTENCE = CTA_SENTENCES_BY_LANGUAGE.en.shorts;

const normalizeSubscribeLike = (value: string) => {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ');
};

const allSubscribeSentences = Array.from(
  new Set(Object.values(CTA_SENTENCES_BY_LANGUAGE).map((v) => v.subscribe)),
);
const allShortsCtaSentences = Array.from(
  new Set(Object.values(CTA_SENTENCES_BY_LANGUAGE).map((v) => v.shorts)),
);

const subscribeNormSet = new Set(
  allSubscribeSentences.map(normalizeSubscribeLike),
);
const shortsCtaNormSet = new Set(
  allShortsCtaSentences.map(normalizeSubscribeLike),
);
const ctaNormSet = new Set(
  [...subscribeNormSet.values(), ...shortsCtaNormSet.values()].filter(Boolean),
);

export const isSubscribeLikeSentence = (text: string) => {
  return ctaNormSet.has(normalizeSubscribeLike(text));
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
