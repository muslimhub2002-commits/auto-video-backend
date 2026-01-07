import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';

export function handleDbError(err: any): never {
  // Postgres: unique_violation
  if (err?.code === '23505') {
    // If you have a named unique constraint this might be err?.constraint
    const detail: string = err?.detail ?? '';
    const isEmail =
      detail.toLowerCase().includes('(email)') ||
      detail.toLowerCase().includes('email');

    if (isEmail) {
      throw new ConflictException({
        error: 'DUPLICATE_EMAIL',
        messageEn: 'This email is already registered.',
        messageAr: 'هذا البريد الإلكتروني مستخدم بالفعل.',
      });
    }

    throw new ConflictException({
      error: 'DUPLICATE_KEY',
      messageEn: 'A record with the same unique value already exists.',
      messageAr: 'يوجد سجل بنفس القيمة الفريدة بالفعل.',
    });
  }

  // Postgres: invalid_text_representation (often invalid uuid)
  if (err?.code === '22P02') {
    throw new BadRequestException({
      error: 'INVALID_INPUT',
      messageEn: 'Invalid input format.',
      messageAr: 'تنسيق الإدخال غير صحيح.',
    });
  }

  // Postgres: foreign_key_violation
  if (err?.code === '23503') {
    throw new ConflictException({
      error: 'FOREIGN_KEY_VIOLATION',
      messageEn:
        'Cannot complete this action because the record is referenced by other data.',
      messageAr: 'لا يمكن إتمام العملية لأن السجل مرتبط ببيانات أخرى.',
    });
  }

  throw new InternalServerErrorException({
    error: 'INTERNAL_ERROR',
    messageEn: 'Something went wrong. Please try again later.',
    messageAr: 'حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقًا.',
  });
}
