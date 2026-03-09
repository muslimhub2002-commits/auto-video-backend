import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SentenceSoundEffectDto {
  @IsUrl({ require_tld: false })
  src: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  delaySeconds?: number;

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
  src: string;

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
  text: string;

  @IsOptional()
  @IsBoolean()
  soundEffectsAlignToSceneEnd?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuspense?: boolean;

  @IsOptional()
  @IsIn(['none', 'glitch', 'whip', 'flash', 'fade', 'chromaLeak'])
  transitionToNext?:
    | 'none'
    | 'glitch'
    | 'whip'
    | 'flash'
    | 'fade'
    | 'chromaLeak'
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
  sentences: SentenceDto[];

  @IsString()
  @IsNotEmpty()
  scriptLength: string;

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
  audioUrl: string;

  @IsArray()
  imageUrls: Array<string | null>;
}
