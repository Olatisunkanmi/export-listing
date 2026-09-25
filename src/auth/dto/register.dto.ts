import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'agent@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, example: 'strongpassword123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Jane Agent' })
  @IsOptional()
  @IsString()
  name?: string;
}
