import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBase64, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export type PaginationType = 'page' | 'cursor';

export class PaginationDto {
  @ApiPropertyOptional({
    description:
      'Pagination style: offset-based "page" (default) or opaque "cursor"',
    enum: ['page', 'cursor'],
    default: 'page',
  })
  @IsOptional()
  @IsIn(['page', 'cursor'])
  paginationType?: PaginationType = 'page';

  @ApiPropertyOptional({
    description: 'Page number (1-indexed) — "page" mode only',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from a previous response\'s pageCursors.next/previous.cursor — "cursor" mode only',
  })
  @IsOptional()
  @IsBase64()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 10,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
