import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TEXT_ANIMATION_EFFECT_VALUES } from '../render-videos.types';

class SentenceSoundEffectDto {
  @IsUrl({ require_tld: false })
  src!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  delaySeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trimStartSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  volumePercent?: number;
}

class TransitionSoundEffectDto {
  @IsUrl({ require_tld: false })
  src!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  delaySeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  volumePercent?: number;
}

class SentenceDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  secondaryImageUrl?: string | null;

  @IsOptional()
  @IsIn(['image', 'video', 'text', 'overlay'])
  mediaType?: 'image' | 'video' | 'text' | 'overlay';

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  textBackgroundVideoUrl?: string;

  @IsOptional()
  @IsString()
  overlayUrl?: string;

  @IsOptional()
  @IsString()
  overlayMimeType?: string | null;

  @IsOptional()
  @IsString()
  textAnimationText?: string | null;

  @IsOptional()
  @IsIn(TEXT_ANIMATION_EFFECT_VALUES)
  textAnimationEffect?: (typeof TEXT_ANIMATION_EFFECT_VALUES)[number] | null;

  @IsOptional()
  @IsObject()
  textAnimationSettings?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  overlaySettings?: Record<string, unknown> | null;

  @IsOptional()
  @IsBoolean()
  soundEffectsAlignToSceneEnd?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuspense?: boolean;

  @IsOptional()
  @IsIn([
    'none',
    'glitch',
    'whip',
    'flash',
    'fade',
    'chromaLeak',
    'impactZoom',
    'slicePush',
    'irisReveal',
    'echoStutter',
    'tiltSnap',
  ])
  transitionToNext?:
    | 'none'
    | 'glitch'
    | 'whip'
    | 'flash'
    | 'fade'
    | 'chromaLeak'
    | 'impactZoom'
    | 'slicePush'
    | 'irisReveal'
    | 'echoStutter'
    | 'tiltSnap'
    | null;

  @IsOptional()
  @IsIn([
    'none',
    'colorGrading',
    'animatedLighting',
    'glassSubtle',
    'glassReflections',
    'glassStrong',
  ])
  visualEffect?:
    | 'none'
    | 'colorGrading'
    | 'animatedLighting'
    | 'glassSubtle'
    | 'glassReflections'
    | 'glassStrong'
    | null;

  @IsOptional()
  @IsIn([
    'default',
    'slowZoomIn',
    'slowZoomOut',
    'diagonalDrift',
    'cinematicPan',
    'focusShift',
    'parallaxMotion',
    'shakeMicroMotion',
    'splitMotion',
    'rotationDrift',
  ])
  imageMotionEffect?:
    | 'default'
    | 'slowZoomIn'
    | 'slowZoomOut'
    | 'diagonalDrift'
    | 'cinematicPan'
    | 'focusShift'
    | 'parallaxMotion'
    | 'shakeMicroMotion'
    | 'splitMotion'
    | 'rotationDrift'
    | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(2.5)
  imageMotionSpeed?: number | null;

  @IsOptional()
  @IsIn(['quick', 'detailed'])
  imageEffectsMode?: 'quick' | 'detailed' | null;

  @IsOptional()
  @IsString()
  imageFilterId?: string | null;

  @IsOptional()
  @IsObject()
  imageFilterSettings?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  motionEffectId?: string | null;

  @IsOptional()
  @IsObject()
  imageMotionSettings?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SentenceSoundEffectDto)
  soundEffects?: SentenceSoundEffectDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionSoundEffectDto)
  transitionSoundEffects?: TransitionSoundEffectDto[];
}

export class CreateRenderVideoUrlDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SentenceDto)
  sentences!: SentenceDto[];

  @IsString()
  @IsNotEmpty()
  scriptLength!: string;

  @IsOptional()
  @IsNumber()
  audioDurationSeconds?: number;

  @IsOptional()
  useLowerFps?: boolean;

  @IsOptional()
  useLowerResolution?: boolean;

  @IsOptional()
  enableGlitchTransitions?: boolean;

  @IsOptional()
  enableZoomRotateTransitions?: boolean;

  @IsOptional()
  @IsBoolean()
  enableLongFormSubscribeOverlay?: boolean;

  @IsOptional()
  addSubtitles?: boolean;

  @IsOptional()
  isShort?: boolean;

  // Optional background soundtrack override.
  // - omit => use default soundtrack
  // - null => mute background music
  // - string => absolute URL
  @IsOptional()
  @IsString()
  backgroundMusicSrc?: string | null;

  // Optional background soundtrack volume override. Expected normalized 0..1.
  @IsOptional()
  @IsNumber()
  backgroundMusicVolume?: number;

  @IsUrl({ require_tld: false })
  audioUrl!: string;

  @IsArray()
  imageUrls!: Array<string | null>;

  @IsOptional()
  @IsArray()
  secondaryImageUrls?: Array<string | null>;
}
