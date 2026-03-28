import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExchangeMetaTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  shortLivedToken: string;
}
