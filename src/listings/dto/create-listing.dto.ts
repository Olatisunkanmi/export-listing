import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { ListingType } from '@prisma/client';

export class CreateListingDto {
  @ApiProperty({
    description: 'Listing title',
    example: '3-bed apartment in Lekki',
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Price in the local currency',
    example: 45000000,
  })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ enum: ListingType, description: 'Listing type' })
  @IsEnum(ListingType)
  type: ListingType;

  @ApiProperty({ description: 'Number of bedrooms', example: 3 })
  @IsInt()
  @Min(0)
  bedrooms: number;

  @ApiProperty({ description: 'Latitude of the property', example: 6.4488 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ description: 'Longitude of the property', example: 3.4732 })
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({
    description: 'Human-readable address',
    example: 'Lekki Phase 1, Lagos',
  })
  @IsOptional()
  @IsString()
  address?: string;
}
