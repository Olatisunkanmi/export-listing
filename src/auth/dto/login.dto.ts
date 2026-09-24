import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'agent@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'strongpassword123' })
  @IsString()
  password: string;
}
