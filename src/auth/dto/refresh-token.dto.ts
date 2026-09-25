import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'A refresh token issued by /auth/login or /auth/register',
  })
  @IsString()
  refreshToken: string;
}
