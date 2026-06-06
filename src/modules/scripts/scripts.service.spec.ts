import { DataSource, Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { ScriptsService } from './scripts.service';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { ScriptTranslationGroup } from './entities/script-translation-group.entity';

describe('ScriptsService.translateToDraft', () => {
  it('translates explicit text animation hook text for translated drafts', async () => {
    const sourceScript = {
      id: 'script-source',
      user_id: 'user-1',
      script: 'Hello world\nSecond line',
      language: 'en',
      title: 'Source draft',
      subject: null,
      subject_content: null,
      length: null,
      style: null,
      technique: null,
      characters: null,
      locations: null,
      isShortScript: false,
    } as Script;

    const sourceSentences = [
      {
        id: 'sentence-1',
        script_id: sourceScript.id,
        index: 0,
        text: 'Hello world',
        text_animation_text: 'Custom hook text',
      },
      {
        id: 'sentence-2',
        script_id: sourceScript.id,
        index: 1,
        text: 'Second line',
        // Simulates a legacy draft that materialized the fallback hook text.
        text_animation_text: 'Second line',
      },
    ] as Sentence[];

    const scriptRepository = {
      findOne: jest.fn().mockResolvedValue(sourceScript),
    } as unknown as Repository<Script>;

    const sentenceRepository = {
      find: jest.fn().mockResolvedValue(sourceSentences),
    } as unknown as Repository<Sentence>;

    const sentenceRepoInTransaction = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };

    const savedDraft = { id: 'translated-draft', user_id: 'user-1' } as Script;
    const scriptRepoInTransaction = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, ...savedDraft })),
    };

    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    const translationGroupRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'group-1', ...value })),
      findOne: jest.fn().mockResolvedValue({
        id: 'group-1',
        user_id: 'user-1',
        scripts: [sourceScript],
      }),
    };

    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: unknown) => {
            if (entity === Script) return scriptRepoInTransaction;
            if (entity === Sentence) return sentenceRepoInTransaction;
            if (entity === ScriptTranslationGroup) {
              return translationGroupRepository;
            }

            throw new Error('Unexpected repository request');
          },
        }),
      ),
    } as unknown as DataSource;

    const aiService = {
      translate: jest
        .fn()
        .mockResolvedValueOnce({
          sentences: ['مرحبا بالعالم', 'السطر الثاني', 'نص الخطاف المترجم'],
        })
        .mockResolvedValueOnce({
          sentences: ['مسودة مترجمة'],
        }),
    } as unknown as AiService;

    const service = new ScriptsService(
      dataSource,
      scriptRepository,
      sentenceRepository,
      {} as Repository<any>,
      {} as Repository<any>,
      {} as Repository<any>,
      {} as Repository<any>,
      {} as Repository<any>,
      aiService,
    );

    jest
      .spyOn(service as any, 'ensureScriptsSchemaLazy')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDraft);

    await service.translateToDraft('script-source', 'user-1', {
      targetLanguage: 'ar',
      method: 'google',
    });

    expect((aiService.translate as jest.Mock).mock.calls[0][0]).toMatchObject({
      targetLanguage: 'ar',
      method: 'google',
      sentences: ['Hello world', 'Second line', 'Custom hook text'],
    });
    expect((aiService.translate as jest.Mock).mock.calls[1][0]).toMatchObject({
      targetLanguage: 'ar',
      method: 'google',
      sentences: ['Source draft'],
    });

    expect(scriptRepoInTransaction.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'مسودة مترجمة',
      }),
    );

    expect(sentenceRepoInTransaction.save).toHaveBeenCalledTimes(1);
    const savedSentences = (sentenceRepoInTransaction.save as jest.Mock).mock
      .calls[0][0] as Array<Record<string, unknown>>;

    expect(savedSentences[0]).toMatchObject({
      text: 'مرحبا بالعالم',
      text_animation_text: 'نص الخطاف المترجم',
    });
    expect(savedSentences[1]).toMatchObject({
      text: 'السطر الثاني',
      text_animation_text: null,
    });
  });
});

describe('ScriptsService', () => {
  it('normalizes supported text animation settings for draft sentence animation saves', () => {
    const service = new ScriptsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const normalized = (
      service as unknown as {
        normalizeTextAnimationSettingsObject: (
          value: unknown,
        ) => Record<string, unknown> | null;
      }
    ).normalizeTextAnimationSettingsObject({
      presetKey: 'slideCutFast',
      wordDelaySeconds: 0.9,
      strokeWidthPx: -4,
    });

    expect(normalized).toMatchObject({
      presetKey: 'slideCutFast',
      wordDelaySeconds: 0.4,
      strokeWidthPx: 0,
    });
  });
});