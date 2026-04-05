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
          textAnimationEffect: 'maskReveal',
          textAnimationText: 'Solid hook',
          textAnimationSettings: {
            backgroundMode: 'solid',
            backgroundColor: '#111827',
          },
        },
        {
          text: 'This hook should inherit an image background',
          mediaType: 'text',
          textAnimationEffect: 'popInBounceHook',
          textAnimationSettings: {
            backgroundMode: 'image',
          },
        },
      ],
      imagePaths: ['', 'hook-background.png'],
      scriptLength: '30 seconds',
      audioDurationSeconds: 2,
      audioSrc: 'audio/voiceover.mp3',
      addSubtitles: true,
    });

    expect(timeline.scenes[0]).toMatchObject({
      mediaType: 'text',
      textAnimationEffect: 'maskReveal',
      textAnimationText: 'Solid hook',
      textAnimationSettings: {
        backgroundMode: 'solid',
      },
    });
    expect(timeline.scenes[0].imageSrc).toBeUndefined();

    expect(timeline.scenes[1]).toMatchObject({
      mediaType: 'text',
      textAnimationEffect: 'popInBounceHook',
      textAnimationSettings: {
        backgroundMode: 'image',
      },
      imageSrc: 'hook-background.png',
    });
  });
});
