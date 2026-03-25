import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  delayRender,
  continueRender,
} from 'remotion';
import type { Timeline } from './types';
import {
  CHROMA_EDGE_FRAMES,
  DEFAULT_BACKGROUND_MUSIC_SRC,
  DEFAULT_CAMERA_CLICK_SFX_URL,
  DEFAULT_CHROMA_LEAK_SFX_URL,
  DEFAULT_GLITCH_FX_URL,
  DEFAULT_SUSPENSE_GLITCH_SFX_URL,
  DEFAULT_WHOOSH_SFX_URL,
  FLASH_EDGE_FRAMES,
  GLITCH_EDGE_FRAMES,
  WHIP_EDGE_FRAMES,
} from './constants';
import {
  preloadMedia,
  resolveMediaSrc,
} from './utils/media';
import { Scene } from './components/Scene';
import { buildCutTransitions, getCutSeed, pickWhipDirection } from './utils/transitions';

export const AutoVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const getTransitionSoundStartFrame = React.useCallback((nextStartFrame: number, transition: string) => {
    if (transition === 'glitch') return Math.max(0, nextStartFrame - GLITCH_EDGE_FRAMES);
    if (transition === 'whip') return Math.max(0, nextStartFrame - WHIP_EDGE_FRAMES - 10);
    if (transition === 'flash') return Math.max(0, nextStartFrame - 8);
    if (transition === 'chromaLeak') return Math.max(0, nextStartFrame - CHROMA_EDGE_FRAMES - 8);
    return Math.max(0, nextStartFrame);
  }, []);

  // Treat empty strings from the backend as "unset" so local `staticFile()` defaults work.
  const rawBackgroundMusicSrc = timeline.assets?.backgroundMusicSrc;
  const backgroundMusicSrc =
    rawBackgroundMusicSrc === null
      ? null
      : rawBackgroundMusicSrc || DEFAULT_BACKGROUND_MUSIC_SRC;

  const rawBackgroundMusicVolume = timeline.assets?.backgroundMusicVolume;
  const backgroundMusicVolume =
    typeof rawBackgroundMusicVolume === 'number' &&
    Number.isFinite(rawBackgroundMusicVolume)
      ? Math.max(0, Math.min(1, rawBackgroundMusicVolume))
      : 1;
  const glitchSfxSrc = timeline.assets?.glitchSfxSrc || DEFAULT_GLITCH_FX_URL;
  const whooshSfxSrc = timeline.assets?.whooshSfxSrc || DEFAULT_WHOOSH_SFX_URL;
  const cameraClickSfxSrc =
    timeline.assets?.cameraClickSfxSrc || DEFAULT_CAMERA_CLICK_SFX_URL;

  // Allow explicit disabling via null, otherwise fall back to a local `staticFile()`.
  // Treat empty strings from the backend as "unset".
  const rawChromaLeakSfxSrc = timeline.assets?.chromaLeakSfxSrc;
  const chromaLeakSfxSrc =
    rawChromaLeakSfxSrc === null
      ? null
      : rawChromaLeakSfxSrc || DEFAULT_CHROMA_LEAK_SFX_URL;
  const suspenseGlitchSfxSrc =
    timeline.assets?.suspenseGlitchSfxSrc || DEFAULT_SUSPENSE_GLITCH_SFX_URL;

  const isVertical = timeline.height > timeline.width;
  const baseHeight = isVertical ? 1920 : 1080;
  const fontScale = Math.max(0.5, Math.min(1, timeline.height / baseHeight));
  const voiceOverVolume = 1; // +0.5 louder than the 0.5 background track (max 1.0)
  const suspenseOpeningScene = timeline.scenes[0];
  const isSuspenseOpening = Boolean(suspenseOpeningScene?.isSuspense);
  const cutTransitions = React.useMemo(() => {
    const base = buildCutTransitions(timeline.scenes);
    return base.map((t, idx) => {
      if (idx === 0) return 'none';
      const prev = timeline.scenes[idx - 1];
      const override = prev?.transitionToNext;
      if (override == null) return t;

      return override;
    });
  }, [timeline.scenes]);
  const showSubtitles = timeline.addSubtitles !== false;
  const recurringSubscribeOverlay = timeline.assets?.recurringSubscribeOverlay;
  const recurringSubscribeOverlaySrc = recurringSubscribeOverlay?.videoSrc
    ? resolveMediaSrc(recurringSubscribeOverlay.videoSrc)
    : null;
  const recurringSubscribeOverlayIntervalFrames = recurringSubscribeOverlay
    ? Math.max(1, Math.round(recurringSubscribeOverlay.intervalSeconds * (timeline.fps || 30)))
    : null;
  const recurringSubscribeOverlayDurationFrames = recurringSubscribeOverlay
    ? Math.max(
        1,
        Math.round(recurringSubscribeOverlay.durationSeconds * (timeline.fps || 30)),
      )
    : null;
  const recurringSubscribeOverlayInset = Math.max(16, Math.round(timeline.width * 0.02));
  const recurringSubscribeOverlayWidth = Math.max(260, Math.round(timeline.width * 0.24));
  const videoScenePremountFrames =
    Math.max(
      FLASH_EDGE_FRAMES,
      GLITCH_EDGE_FRAMES,
      WHIP_EDGE_FRAMES,
      CHROMA_EDGE_FRAMES,
    ) + 2;

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
    if (recurringSubscribeOverlaySrc) {
      sources.add(recurringSubscribeOverlaySrc);
    }

    for (const scene of timeline.scenes) {
      if (scene.imageSrc) sources.add(resolveMediaSrc(scene.imageSrc));
      if (scene.secondaryImageSrc) {
        sources.add(resolveMediaSrc(scene.secondaryImageSrc));
      }
      if (scene.videoSrc) sources.add(resolveMediaSrc(scene.videoSrc));

      const soundEffects = Array.isArray(scene.soundEffects)
        ? scene.soundEffects
        : [];
      for (const se of soundEffects) {
        const src = String(se?.src ?? '').trim();
        if (src) sources.add(resolveMediaSrc(src));
      }

      const transitionSoundEffects = Array.isArray(scene.transitionSoundEffects)
        ? scene.transitionSoundEffects
        : [];
      for (const se of transitionSoundEffects) {
        const src = String(se?.src ?? '').trim();
        if (src) sources.add(resolveMediaSrc(src));
      }
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
  }, [preloadHandle, recurringSubscribeOverlaySrc, timeline]);

  const recurringSubscribeOverlayStartFrames = React.useMemo(() => {
    if (
      !recurringSubscribeOverlay ||
      !recurringSubscribeOverlaySrc ||
      !recurringSubscribeOverlayIntervalFrames ||
      !recurringSubscribeOverlayDurationFrames
    ) {
      return [] as number[];
    }

    const starts: number[] = [];
    for (
      let startFrame = recurringSubscribeOverlayIntervalFrames;
      startFrame < timeline.durationInFrames;
      startFrame += recurringSubscribeOverlayIntervalFrames
    ) {
      starts.push(startFrame);
    }

    return starts;
  }, [
    recurringSubscribeOverlay,
    recurringSubscribeOverlayDurationFrames,
    recurringSubscribeOverlayIntervalFrames,
    recurringSubscribeOverlaySrc,
    timeline.durationInFrames,
  ]);


  return (
    <AbsoluteFill>
      {timeline.audioSrc && (
        <Audio src={resolveMediaSrc(timeline.audioSrc)} volume={voiceOverVolume} />
      )}
      {backgroundMusicSrc ? (
        <Audio src={resolveMediaSrc(backgroundMusicSrc)} volume={backgroundMusicVolume} loop />
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

      {/* Per-sentence sound effects. */}
      {timeline.scenes.map((scene) => {
        const soundEffects = Array.isArray(scene.soundEffects)
          ? scene.soundEffects
          : [];
        if (soundEffects.length === 0) return null;

        return soundEffects.map((se, sfxIdx) => {
          const src = String(se?.src ?? '').trim();
          if (!src) return null;

          const delaySecondsRaw = Number(se?.delaySeconds ?? 0);
          const delaySeconds = Number.isFinite(delaySecondsRaw)
            ? Math.max(0, delaySecondsRaw)
            : 0;
          const from =
            scene.startFrame + Math.round(delaySeconds * (timeline.fps || 30));
          if (from >= timeline.durationInFrames) return null;

          const trimStartSecondsRaw = Number(se?.trimStartSeconds ?? 0);
          const trimStartSeconds = Number.isFinite(trimStartSecondsRaw)
            ? Math.max(0, trimStartSecondsRaw)
            : 0;
          const trimStartFrames = Math.max(
            0,
            Math.round(trimStartSeconds * (timeline.fps || 30)),
          );

          const durationSecondsRaw = Number(se?.durationSeconds ?? 0);
          const durationFrames =
            Number.isFinite(durationSecondsRaw) && durationSecondsRaw > 0
              ? Math.max(1, Math.round(durationSecondsRaw * (timeline.fps || 30)))
              : undefined;
          const remainingFrames = Math.max(1, timeline.durationInFrames - from);
          const sequenceDurationFrames = durationFrames
            ? Math.min(durationFrames, remainingFrames)
            : undefined;

          const volumeRaw = Number(se?.volume ?? 1);
          const volume = Number.isFinite(volumeRaw)
            ? Math.max(0, Math.min(3, volumeRaw))
            : 1;

          return (
            <Sequence
              key={`sentence-sfx-${scene.index}-${sfxIdx}`}
              from={Math.max(0, from)}
              durationInFrames={sequenceDurationFrames}
            >
              <Audio src={resolveMediaSrc(src)} volume={volume} startFrom={trimStartFrames} />
            </Sequence>
          );
        });
      })}

      {/* Custom transition sound overrides. */}
      {timeline.scenes.map((prev, idx) => {
        if (idx >= timeline.scenes.length - 1) return null;

        const next = timeline.scenes[idx + 1];
        const transition = cutTransitions[idx + 1] ?? 'none';
        const transitionSoundEffects = Array.isArray(prev.transitionSoundEffects)
          ? prev.transitionSoundEffects
          : [];

        if (transitionSoundEffects.length === 0) return null;

        const anchorFrame = getTransitionSoundStartFrame(next.startFrame, transition);

        return transitionSoundEffects.map((se, sfxIdx) => {
          const src = String(se?.src ?? '').trim();
          if (!src) return null;

          const delaySecondsRaw = Number(se?.delaySeconds ?? 0);
          const delaySeconds = Number.isFinite(delaySecondsRaw)
            ? Math.max(0, delaySecondsRaw)
            : 0;
          const from = anchorFrame + Math.round(delaySeconds * (timeline.fps || 30));
          if (from >= timeline.durationInFrames) return null;

          const volumeRaw = Number(se?.volume ?? 1);
          const volume = Number.isFinite(volumeRaw)
            ? Math.max(0, Math.min(3, volumeRaw))
            : 1;

          return (
            <Sequence
              key={`transition-sfx-${prev.index}-${next.index}-${sfxIdx}`}
              from={Math.max(0, from)}
            >
              <Audio src={resolveMediaSrc(src)} volume={volume} />
            </Sequence>
          );
        });
      })}

      {/* Glitch SFX during glitch cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prev = timeline.scenes[idx - 1];
        const prevIndex = prev.index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'glitch') return null;
        if ((prev.transitionSoundEffects ?? []).length > 0) return null;
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

      {/* Whoosh SFX during whip cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prev = timeline.scenes[idx - 1];
        const prevIndex = prev.index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'whip') return null;
        if ((prev.transitionSoundEffects ?? []).length > 0) return null;
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

      {/* Camera click SFX during flash cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prev = timeline.scenes[idx - 1];
        const prevIndex = prev.index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'flash') return null;
        if ((prev.transitionSoundEffects ?? []).length > 0) return null;
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

      {/* Chroma leak SFX during chromaLeak cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prev = timeline.scenes[idx - 1];
        const prevIndex = prev.index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'chromaLeak') return null;
        if ((prev.transitionSoundEffects ?? []).length > 0) return null;
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
        const premountFor = scene.videoSrc ? videoScenePremountFrames : 0;

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
            premountFor={premountFor}
          >
            <Scene
              scene={scene}
              language={timeline.language}
              fontScale={fontScale}
              showSubtitles={showSubtitles}
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

      {recurringSubscribeOverlayStartFrames.map((startFrame, idx) => {
        if (!recurringSubscribeOverlaySrc || !recurringSubscribeOverlayDurationFrames) {
          return null;
        }

        const remainingFrames = timeline.durationInFrames - startFrame;
        if (remainingFrames <= 0) return null;

        return (
          <Sequence
            key={`long-form-subscribe-overlay-${idx}`}
            from={startFrame}
            durationInFrames={Math.min(
              recurringSubscribeOverlayDurationFrames,
              remainingFrames,
            )}
          >
            <AbsoluteFill style={{ pointerEvents: 'none' }}>
              <OffthreadVideo
                src={recurringSubscribeOverlaySrc}
                muted
                pauseWhenBuffering
                style={{
                  position: 'absolute',
                  top: recurringSubscribeOverlayInset,
                  left: recurringSubscribeOverlayInset,
                  width: recurringSubscribeOverlayWidth,
                  height: 'auto',
                  objectFit: 'contain',
                }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};


