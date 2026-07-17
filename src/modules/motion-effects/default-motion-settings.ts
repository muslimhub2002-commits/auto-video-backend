/**
 * Default motion effect settings that mirror the frontend's
 * `getDefaultImageMotionSettings()` in ImageEffectPreview.tsx.
 *
 * These are the "system presets" — the AI can select them by title
 * and the backend resolves the title to the full settings.
 */

export type MotionEffectTitle =
    | 'slowZoomIn'
    | 'slowZoomOut'
    | 'diagonalDrift'
    | 'cinematicPan'
    | 'focusShift'
    | 'parallaxMotion'
    | 'shakeMicroMotion'
    | 'splitMotion'
    | 'rotationDrift';

export const DEFAULT_MOTION_EFFECT_TITLES: readonly MotionEffectTitle[] = [
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

export type MotionEffectSettings = Record<string, unknown>;

const baseDefaults = {
    speed: 1.2,
    originX: 50,
    originY: 50,
    scaleEndNoLimit: true,
    translateXEndNoLimit: true,
    translateYEndNoLimit: true,
    rotateEndNoLimit: true,
};

/**
 * Returns the hardcoded default settings for a built-in motion effect.
 * Does NOT include 'default' — that means "no special effect".
 */
export function getDefaultMotionSettings(
    effect: MotionEffectTitle,
): MotionEffectSettings {
    switch (effect) {
        case 'slowZoomIn':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.01,
                endScale: 1.085,
                translateXStart: 0,
                translateXEnd: 0,
                translateYStart: 0,
                translateYEnd: 0,
                rotateStart: 0,
                rotateEnd: 0,
            };
        case 'slowZoomOut':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.095,
                endScale: 1.01,
                translateXStart: 0,
                translateXEnd: 0,
                translateYStart: 0,
                translateYEnd: 0,
                rotateStart: 0,
                rotateEnd: 0,
            };
        case 'diagonalDrift':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.04,
                endScale: 1.09,
                translateXStart: -3.5,
                translateXEnd: 3.5,
                translateYStart: -2.5,
                translateYEnd: 2.5,
                rotateStart: 0,
                rotateEnd: 0,
            };
        case 'cinematicPan':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.08,
                endScale: 1.08,
                translateXStart: -4.5,
                translateXEnd: 4.5,
                translateYStart: 0,
                translateYEnd: 0,
                rotateStart: 0,
                rotateEnd: 0,
            };
        case 'focusShift':
            return {
                presetKey: effect,
                ...baseDefaults,
                originX: 38,
                originY: 34,
                startScale: 1.03,
                endScale: 1.1,
                translateXStart: 2,
                translateXEnd: 1,
                translateYStart: 1.5,
                translateYEnd: -2,
                rotateStart: 0,
                rotateEnd: 0,
            };
        case 'parallaxMotion':
            return {
                presetKey: effect,
                ...baseDefaults,
                originX: 50,
                originY: 42,
                startScale: 1.09,
                endScale: 1.11,
                translateXStart: -2,
                translateXEnd: 2.5,
                translateYStart: -1,
                translateYEnd: 1.5,
                rotateStart: -0.8,
                rotateEnd: 1,
            };
        case 'shakeMicroMotion':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.045,
                endScale: 1.058,
                translateXStart: -0.45,
                translateXEnd: 0.42,
                translateYStart: 0.2,
                translateYEnd: -0.24,
                rotateStart: -0.35,
                rotateEnd: 0.28,
            };
        case 'splitMotion':
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1.09,
                endScale: 1.11,
                translateXStart: -2.8,
                translateXEnd: -1.4,
                translateYStart: -1.2,
                translateYEnd: 2.4,
                rotateStart: -0.55,
                rotateEnd: -0.25,
            };
        case 'rotationDrift':
            return {
                presetKey: effect,
                ...baseDefaults,
                originX: 52,
                originY: 46,
                startScale: 1.055,
                endScale: 1.1,
                translateXStart: -1.2,
                translateXEnd: 0.8,
                translateYStart: 0.6,
                translateYEnd: 1.2,
                rotateStart: -1.2,
                rotateEnd: 1.35,
            };
        default:
            return {
                presetKey: effect,
                ...baseDefaults,
                startScale: 1,
                endScale: 1.055,
                translateXStart: 0,
                translateXEnd: 0,
                translateYStart: 0,
                translateYEnd: 0,
                rotateStart: 0,
                rotateEnd: 0,
            };
    }
}

/**
 * User preset shape as received from the motion_effects table.
 */
export type UserMotionPreset = {
    id: string;
    title: string;
    settings: Record<string, unknown>;
};

/**
 * Result of resolving a title to a concrete motion effect.
 */
export type ResolvedMotionEffect = {
    sentenceId: string;
    index: number;
    imageMotionEffect: MotionEffectTitle;
    motionEffectId: string | null;
    imageMotionSettings: MotionEffectSettings;
};

/**
 * Given a title returned by the AI, resolves it to a full motion effect:
 * - User presets are checked first (they take priority over defaults)
 * - Then default built-in effects
 * - Returns null if the title doesn't match anything
 */
export function resolveMotionEffectByTitle(params: {
    title: string;
    sentenceId: string;
    index: number;
    userPresets: UserMotionPreset[];
}): ResolvedMotionEffect | null {
    const normalizedTitle = String(params.title ?? '').trim();
    if (!normalizedTitle) return null;

    // Check user presets first (priority over defaults)
    const userPreset = params.userPresets.find(
        (preset) => preset.title === normalizedTitle,
    );
    if (userPreset) {
        const presetKey = String(
            (userPreset.settings as any)?.presetKey ?? '',
        ).trim();
        const imageMotionEffect: MotionEffectTitle =
            DEFAULT_MOTION_EFFECT_TITLES.includes(presetKey as any)
                ? (presetKey as MotionEffectTitle)
                : 'slowZoomIn'; // fallback for presets without a valid presetKey

        return {
            sentenceId: params.sentenceId,
            index: params.index,
            imageMotionEffect,
            motionEffectId: userPreset.id,
            imageMotionSettings: userPreset.settings,
        };
    }

    // Check default effects
    const defaultEffect = DEFAULT_MOTION_EFFECT_TITLES.find(
        (effect) => effect === normalizedTitle,
    );
    if (defaultEffect) {
        return {
            sentenceId: params.sentenceId,
            index: params.index,
            imageMotionEffect: defaultEffect,
            motionEffectId: null,
            imageMotionSettings: getDefaultMotionSettings(defaultEffect),
        };
    }

    return null;
}

/**
 * Builds a list of available motion effect titles for the AI prompt.
 */
export function buildAvailableMotionTitles(
    userPresets: UserMotionPreset[],
): string[] {
    const titles = new Set<string>(DEFAULT_MOTION_EFFECT_TITLES);
    for (const preset of userPresets) {
        const title = String(preset.title ?? '').trim();
        if (title) titles.add(title);
    }
    return Array.from(titles);
}
