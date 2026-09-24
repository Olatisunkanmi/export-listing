import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ListingType } from '@prisma/client';

export type ListingSortBy = 'distance' | 'price' | 'bedrooms' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export class SearchListingsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ListingType })
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @ApiPropertyOptional({ description: 'Minimum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Number of bedrooms (exact match)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @ApiPropertyOptional({
    description:
      'Free-text search over title and address (case-insensitive, substring match)',
  })
  @IsOptional()
  @IsString()
  term?: string;

  @ApiPropertyOptional({ description: 'Latitude of the search origin point' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude of the search origin point' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description: 'Search radius in kilometers from (lat, lng)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  radiusKm?: number;

  @ApiPropertyOptional({
    enum: ['distance', 'price', 'bedrooms', 'createdAt'],
    description:
      '"distance" is only valid for a location search (lat/lng/radiusKm). Defaults to "distance" for a location search, "createdAt" otherwise.',
  })
  @IsOptional()
  @IsIn(['distance', 'price', 'bedrooms', 'createdAt'])
  sortBy?: ListingSortBy;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Defaults to "asc" for distance, "desc" otherwise.',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: SortDirection;
}
