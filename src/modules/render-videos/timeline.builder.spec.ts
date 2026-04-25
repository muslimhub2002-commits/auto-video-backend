import { buildTimeline } from './timeline.builder';

describe('buildTimeline', () => {
  it('maps sentence word timings into frame-relative subtitle words', () => {
    const timeline = buildTimeline({
      language: 'en',
      sentences: [{ text: 'Hello world' }, { text: 'Second scene' }],
      imagePaths: ['one.png', 'two.png'],
      scriptLength: '30 seconds',
      audioDurationSeconds: 2,
      audioSrc: 'audio/voiceover.mp3',
      addSubtitles: true,
      sentenceTimings: [
        {
          index: 0,
          text: 'Hello world',
          startSeconds: 0,
          endSeconds: 1,
          words: [
            { text: 'Hello', startSeconds: 0, endSeconds: 0.45 },
            { text: 'world', startSeconds: 0.45, endSeconds: 1 },
          ],
        },
        {
          index: 1,
          text: 'Second scene',
          startSeconds: 1,
          endSeconds: 2,
          words: [
            { text: 'Second', startSeconds: 1, endSeconds: 1.4 },
            { text: 'scene', startSeconds: 1.4, endSeconds: 2 },
          ],
        },
      ],
    });

    expect(timeline.scenes).toHaveLength(2);
    expect(timeline.scenes[0].subtitleWords).toEqual([
      { text: 'Hello', startFrame: 0, endFrame: 14 },
      { text: 'world', startFrame: 13, endFrame: 30 },
    ]);
    expect(timeline.scenes[1].subtitleWords).toEqual([
      { text: 'Second', startFrame: 0, endFrame: 12 },
      { text: 'scene', startFrame: 12, endFrame: 30 },
    ]);
  });

  it('preserves text scene metadata and only binds a primary image when needed', () => {
    const timeline = buildTimeline({
      language: 'en',
      sentences: [
        {
          text: 'This hook should use a solid background',
          mediaType: 'text',
          textAnimationEffect: 'slideCutFast',
          textAnimationText: 'Solid hook',
          textAnimationSettings: {
            backgroundMode: 'solid',
            backgroundColor: '#111827',
            animatePerWord: true,
            wordDelaySeconds: 0.12,
          },
        },
        {
          text: 'This hook should inherit an image background',
          mediaType: 'text',
          textAnimationEffect: 'slideCutFast',
          textAnimationSettings: {
            backgroundMode: 'image',
          },
          visualEffect: 'colorGrading',
          imageFilterSettings: {
            contrast: 1.18,
            saturation: 1.14,
          },
        },
        {
          text: 'This hook should inherit a video background with a look',
          mediaType: 'text',
          textAnimationEffect: 'slideCutFast',
          textAnimationSettings: {
            backgroundMode: 'inheritVideo',
          },
          textBackgroundVideoUrl: 'looping-hook.mp4',
          visualEffect: 'glassReflections',
          imageFilterSettings: {
            brightness: 1.06,
            glassOverlayOpacity: 0.22,
          },
        },
      ],
      imagePaths: ['', 'hook-background.png', 'video-fallback.png'],
      scriptLength: '30 seconds',
      audioDurationSeconds: 3,
      audioSrc: 'audio/voiceover.mp3',
      addSubtitles: true,
    });

    expect(timeline.scenes[0]).toMatchObject({
      mediaType: 'text',
      textAnimationEffect: 'slideCutFast',
      textAnimationText: 'Solid hook',
      textAnimationSettings: {
        backgroundMode: 'solid',
        animatePerWord: true,
        wordDelaySeconds: 0.12,
      },
    });
    expect(timeline.scenes[0].imageSrc).toBeUndefined();

    expect(timeline.scenes[1]).toMatchObject({
      mediaType: 'text',
      textAnimationEffect: 'slideCutFast',
      textAnimationSettings: {
        backgroundMode: 'image',
      },
      visualEffect: 'colorGrading',
      imageFilterSettings: {
        contrast: 1.18,
        saturation: 1.14,
      },
      imageSrc: 'hook-background.png',
    });

    expect(timeline.scenes[2]).toMatchObject({
      mediaType: 'text',
      textAnimationEffect: 'slideCutFast',
      textAnimationSettings: {
        backgroundMode: 'inheritVideo',
      },
      visualEffect: 'glassReflections',
      imageFilterSettings: {
        brightness: 1.06,
        glassOverlayOpacity: 0.22,
      },
      textBackgroundVideoSrc: 'looping-hook.mp4',
    });
    expect(timeline.scenes[2].imageSrc).toBeUndefined();
  });

  it('preserves overlay text animation metadata when includeText is enabled', () => {
    const timeline = buildTimeline({
      language: 'en',
      sentences: [
        {
          text: 'Overlay scene should reuse the text tab animation',
          mediaType: 'overlay',
          overlayUrl: 'https://example.com/overlay-hero.png',
          overlayMimeType: 'image/png',
          overlaySettings: {
            backgroundMode: 'image',
            includeText: true,
            textLayer: 'below',
            widthPercent: 32,
          },
          textAnimationEffect: 'slideCutFast',
          textAnimationText: 'Overlay hero',
          textAnimationSettings: {
            animatePerWord: true,
            wordDelaySeconds: 0.1,
            fontSizePercent: 15,
            offsetX: 6,
            offsetY: -8,
            textColor: '#f8fafc',
            accentColor: '#22d3ee',
          },
        },
        {
          text: 'Overlay scene with a solid background should not bind an image',
          mediaType: 'overlay',
          overlayUrl: 'https://example.com/overlay-solid.png',
          overlayMimeType: 'image/png',
          overlaySettings: {
            backgroundMode: 'solid',
            includeText: true,
            textLayer: 'above',
            backgroundColor: '#020617',
          },
          textAnimationEffect: 'slideCutFast',
          textAnimationText: 'Solid overlay',
          textAnimationSettings: {
            fontSizePercent: 11,
            offsetY: -10,
            textColor: '#ffffff',
          },
        },
      ],
      imagePaths: ['overlay-background.png', 'unused-image.png'],
      scriptLength: '30 seconds',
      audioDurationSeconds: 2,
      audioSrc: 'audio/voiceover.mp3',
      addSubtitles: true,
    });

    expect(timeline.scenes[0]).toMatchObject({
      mediaType: 'overlay',
      overlaySrc: 'https://example.com/overlay-hero.png',
      overlayMimeType: 'image/png',
      overlaySettings: {
        backgroundMode: 'image',
        includeText: true,
        textLayer: 'below',
        widthPercent: 32,
      },
      textAnimationEffect: 'slideCutFast',
      textAnimationText: 'Overlay hero',
      textAnimationSettings: {
        animatePerWord: true,
        wordDelaySeconds: 0.1,
        fontSizePercent: 15,
        offsetX: 6,
        offsetY: -8,
        textColor: '#f8fafc',
        accentColor: '#22d3ee',
      },
      imageSrc: 'overlay-background.png',
    });

    expect(timeline.scenes[1]).toMatchObject({
      mediaType: 'overlay',
      overlaySrc: 'https://example.com/overlay-solid.png',
      overlayMimeType: 'image/png',
      overlaySettings: {
        backgroundMode: 'solid',
        includeText: true,
        textLayer: 'above',
        backgroundColor: '#020617',
      },
      textAnimationEffect: 'slideCutFast',
      textAnimationText: 'Solid overlay',
      textAnimationSettings: {
        fontSizePercent: 11,
        offsetY: -10,
        textColor: '#ffffff',
      },
    });
    expect(timeline.scenes[1].imageSrc).toBeUndefined();
  });

  it('preserves video scene look settings for render output', () => {
    const timeline = buildTimeline({
      language: 'en',
      sentences: [
        {
          text: 'Video scene with a saved look',
          mediaType: 'video',
          videoUrl: 'https://example.com/clip.mp4',
          visualEffect: 'glassStrong',
          imageFilterSettings: {
            saturation: 1.12,
            brightness: 1.04,
            glassOverlayOpacity: 0.28,
          },
        },
      ],
      imagePaths: ['fallback-image.png'],
      scriptLength: '30 seconds',
      audioDurationSeconds: 1,
      audioSrc: 'audio/voiceover.mp3',
      addSubtitles: true,
    });

    expect(timeline.scenes[0]).toMatchObject({
      mediaType: 'video',
      videoSrc: 'https://example.com/clip.mp4',
      visualEffect: 'glassStrong',
      imageFilterSettings: {
        saturation: 1.12,
        brightness: 1.04,
        glassOverlayOpacity: 0.28,
      },
    });
  });
});
