import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Html5Audio,
  Sequence,
  delayRender,
  continueRender,
} from 'remotion';
import type { Timeline } from './types';
import {
  CHROMA_EDGE_FRAMES,
  DEFAULT_BACKGROUND_MUSIC_SRC,
  DEFAULT_CAMERA_CLICK_SFX_URL,
  DEFAULT_GLITCH_FX_URL,
  DEFAULT_SUSPENSE_GLITCH_SFX_URL,
  DEFAULT_WHOOSH_SFX_URL,
  GLITCH_EDGE_FRAMES,
  WHIP_EDGE_FRAMES,
} from './constants';
import { preloadMedia, resolveMediaSrc } from './utils/media';
import { Scene } from './components/Scene';
import { buildCutTransitions, getCutSeed, pickWhipDirection } from './utils/transitions';

export const AutoVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const backgroundMusicSrc =
    timeline.assets?.backgroundMusicSrc ?? DEFAULT_BACKGROUND_MUSIC_SRC;
  const glitchSfxSrc = timeline.assets?.glitchSfxSrc ?? DEFAULT_GLITCH_FX_URL;
  const whooshSfxSrc = timeline.assets?.whooshSfxSrc ?? DEFAULT_WHOOSH_SFX_URL;
  const cameraClickSfxSrc =
    timeline.assets?.cameraClickSfxSrc ?? DEFAULT_CAMERA_CLICK_SFX_URL;
  const chromaLeakSfxSrc = timeline.assets?.chromaLeakSfxSrc ?? '';
  const suspenseGlitchSfxSrc =
    timeline.assets?.suspenseGlitchSfxSrc ?? DEFAULT_SUSPENSE_GLITCH_SFX_URL;

  const isVertical = timeline.height > timeline.width;
  const baseHeight = isVertical ? 1920 : 1080;
  const fontScale = Math.max(0.5, Math.min(1, timeline.height / baseHeight));
  const voiceOverVolume = 1; // +0.5 louder than the 0.5 background track (max 1.0)
  const suspenseOpeningScene = timeline.scenes[0];
  const isSuspenseOpening = Boolean(suspenseOpeningScene?.isSuspense);
  const cutTransitions = React.useMemo(() => buildCutTransitions(timeline.scenes), [
    timeline.scenes,
  ]);

  // Preload remote media so we don't show the black background while assets fetch.
  const preloadHandle = React.useMemo(
    () => delayRender('preload-media'),
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    let didContinue = false;

    const safeContinue = () => {
      if (didContinue) return;
      didContinue = true;
      continueRender(preloadHandle);
    };

    const sources = new Set<string>();

    if (timeline.audioSrc) sources.add(resolveMediaSrc(timeline.audioSrc));

    // Global background music + transition SFX (either remote URLs or staticFile()).
    if (backgroundMusicSrc) sources.add(resolveMediaSrc(backgroundMusicSrc));
    if (glitchSfxSrc) sources.add(resolveMediaSrc(glitchSfxSrc));
    if (whooshSfxSrc) sources.add(resolveMediaSrc(whooshSfxSrc));
    if (chromaLeakSfxSrc) sources.add(resolveMediaSrc(chromaLeakSfxSrc));
    if (cameraClickSfxSrc) sources.add(resolveMediaSrc(cameraClickSfxSrc));
    if (isSuspenseOpening && suspenseGlitchSfxSrc) {
      sources.add(resolveMediaSrc(suspenseGlitchSfxSrc));
    }

    for (const scene of timeline.scenes) {
      if (scene.imageSrc) sources.add(resolveMediaSrc(scene.imageSrc));
      if (scene.videoSrc) sources.add(resolveMediaSrc(scene.videoSrc));
    }

    const run = async () => {
      const tasks = Array.from(sources).map((src) => preloadMedia(src));
      await Promise.allSettled(tasks);
      if (!cancelled) safeContinue();
    };

    // Safety net: never hang rendering forever if a remote host is slow.
    const timeout = setTimeout(() => {
      if (!cancelled) safeContinue();
    }, 15000);

    run().finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      // If React remounts/unmounts quickly (e.g. StrictMode), ensure we never
      // leave a delayRender handle unresolved which would hang rendering.
      safeContinue();
    };
  }, [preloadHandle, timeline]);


  return (
    <AbsoluteFill>
      {timeline.audioSrc && (
        <Html5Audio src={resolveMediaSrc(timeline.audioSrc)} volume={voiceOverVolume} />
      )}
      {backgroundMusicSrc ? (
        <Audio src={resolveMediaSrc(backgroundMusicSrc)} volume={0.8} />
      ) : null}

      {/* Suspense opening SFX: plays once and stops when audio ends (or at end of scene). */}
      {isSuspenseOpening && suspenseOpeningScene ? (
        <Sequence
          from={suspenseOpeningScene.startFrame}
          durationInFrames={suspenseOpeningScene.durationFrames}
        >
          {suspenseGlitchSfxSrc ? (
            <Audio src={resolveMediaSrc(suspenseGlitchSfxSrc)} volume={0.2} />
          ) : null}
        </Sequence>
      ) : null}

      {/* Glitch SFX only during image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'glitch') return null;
        if (!glitchSfxSrc) return null;

        const from = Math.max(0, next.startFrame - GLITCH_EDGE_FRAMES);

        return (
          <Sequence
            key={`glitch-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(glitchSfxSrc)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Whoosh SFX only during whip image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'whip') return null;
        if (!whooshSfxSrc) return null;

        const from = Math.max(0, next.startFrame - WHIP_EDGE_FRAMES - 10);

        return (
          <Sequence
            key={`whoosh-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(whooshSfxSrc)} volume={0.85} />
          </Sequence>
        );
      })}

      {/* Camera click SFX only during flash image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'flash') return null;
        if (!cameraClickSfxSrc) return null;

        // Trigger right on the cut.
        const from = Math.max(0, next.startFrame - 8);

        return (
          <Sequence
            key={`flash-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(cameraClickSfxSrc)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Chroma leak SFX only during chromaLeak image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'chromaLeak') return null;
        if (!chromaLeakSfxSrc) return null;

        const from = Math.max(0, next.startFrame - CHROMA_EDGE_FRAMES - 8);

        return (
          <Sequence key={`chroma-sfx-${prevIndex}-${next.index}`} from={from}>
            <Audio src={resolveMediaSrc(chromaLeakSfxSrc)} volume={0.9} />
          </Sequence>
        );
      })}

      {timeline.scenes.map((scene, idx) => {
        const prev = idx > 0 ? timeline.scenes[idx - 1] : null;
        const next = idx + 1 < timeline.scenes.length ? timeline.scenes[idx + 1] : null;

        const transitionFromPrev = idx > 0 ? (cutTransitions[idx] ?? 'none') : 'none';
        const transitionToNext =
          idx + 1 < timeline.scenes.length ? (cutTransitions[idx + 1] ?? 'none') : 'none';

        const seedFromPrev =
          prev && (transitionFromPrev === 'glitch' || transitionFromPrev === 'chromaLeak')
            ? getCutSeed(prev, scene)
            : 0;
        const seedToNext =
          next && (transitionToNext === 'glitch' || transitionToNext === 'chromaLeak')
            ? getCutSeed(scene, next)
            : 0;

        const whipDirFromPrev =
          prev && transitionFromPrev === 'whip' ? pickWhipDirection(prev, scene) : 1;
        const whipDirToNext =
          next && transitionToNext === 'whip' ? pickWhipDirection(scene, next) : 1;

        return (
          <Sequence
            key={scene.index}
            from={scene.startFrame}
            durationInFrames={scene.durationFrames}
          >
            <Scene
              scene={scene}
              fontScale={fontScale}
              transitionFromPrev={transitionFromPrev}
              transitionToNext={transitionToNext}
              seedFromPrev={seedFromPrev}
              seedToNext={seedToNext}
              whipDirFromPrev={whipDirFromPrev}
              whipDirToNext={whipDirToNext}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};


