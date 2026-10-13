import { Controller, Get, Param, Version } from '@nestjs/common';
import { ROUTES } from './events';

export class UserDto {
  id!: number;
  name!: string;
}

@Controller(ROUTES.USERS)
export class UsersController {
  /** List all users. */
  @Get()
  list(): UserDto[] {
    return [{ id: 1, name: 'Ada' }];
  }

  /** Get a user. */
  @Get(':id')
  get(@Param('id') id: string): UserDto {
    return { id: Number(id), name: 'Ada' };
  }

  /** Users, second edition. */
  @Version('2')
  @Get('all')
  listV2(): UserDto[] {
    return [];
  }
}
