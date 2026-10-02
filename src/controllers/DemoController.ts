/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  MODERATOR = 'moderator',
}

export class AddressDto {
  street!: string;
  city!: string;
  country!: string;
  zipCode?: string;
}

export class PostDto {
  id!: number;
  title!: string;
  content!: string;
  author!: UserDto; // Circular reference
  tags!: string[];
  createdAt!: Date;
  published!: boolean;
}

export class UserDto {
  id!: number;
  name!: string;
  email!: string;
  role!: UserRole;
  address!: AddressDto;
  posts!: PostDto[]; // Circular reference
  isActive!: boolean;
  createdAt!: Date;
}

export class CreateUserDto {
  name!: string;
  email!: string;
  role?: UserRole;
  address!: AddressDto;
}

export class UpdateUserDto {
  name?: string;
  email?: string;
  role?: UserRole;
  address?: AddressDto;
  isActive?: boolean;
}

@Controller('users')
export class DemoController {
  @Get()
  getUsers(@Query('limit') limit?: number, @Query('offset') offset?: number): UserDto[] {
    // This would return an array of users
    return [];
  }

  @Get(':id')
  getUser(@Param('id') id: number): UserDto {
    // This would return a single user
    return {} as UserDto;
  }

  @Post()
  createUser(@Body() createUserDto: CreateUserDto): UserDto {
    // This would create and return a user
    return {} as UserDto;
  }

  @Post(':id/posts')
  createPostForUser(@Param('id') userId: number, @Body() postData: { title: string; content: string }): PostDto {
    // This would create a post for a user
    return {} as PostDto;
  }
}