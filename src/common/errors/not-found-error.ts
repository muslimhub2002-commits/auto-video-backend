import { NotFoundException } from '@nestjs/common';

export function notFoundError({ item }: { item?: { en: string; ar: string } }) {
  if (!item) {
    item = {
      en: 'Data not found.',
      ar: 'البيانات غير موجودة.',
    };
  }
  throw new NotFoundException({
    error: 'NOT_FOUND',
    messageEn: item ? item.en : 'Data not found.',
    messageAr: item ? item.ar : 'البيانات غير موجودة.',
  });
}
