import { Body, Controller, Get, Param, Post } from '@nestjs/common';

export class CreateUserDto {
  name!: string;
  email?: string;
}

@Controller('users')
export class UsersController {
  /** List all users. */
  @Get()
  list(): { id: number; name: string }[] { return []; }

  /** Get a user by id. */
  @Get(':id')
  get(@Param('id') id: string): { id: number; name: string } { return { id: Number(id), name: 'Ada' }; }

  /** Create a user. */
  @Post()
  create(@Body() body: CreateUserDto): { id: number; name: string } { return { id: 2, name: body.name }; }
}
