import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class GoogleExchangeDto {
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  idToken: string;
}