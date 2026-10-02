import { Body, Controller, Post } from '@nestjs/common';
import { createZodDto } from './create-zod-dto';

// Minimal typed stub that mirrors the `z` API used in this fixture. The
// analyzer only needs the AST shape; these objects are never executed.
interface ZodString {
  min(n: number): ZodString;
  max(n: number): ZodString;
  email(): ZodString;
  optional(): ZodString;
  describe(text: string): ZodString;
}
interface ZodNumber { optional(): ZodNumber; }
interface ZodBoolean {}
interface ZodEnum<T extends string[]> { values: T; }
interface ZodArray<T> { item: T; }
interface ZodObject<T> {}

const z = {
  object<T extends Record<string, unknown>>(shape: T): ZodObject<T> {
    return {} as unknown as ZodObject<T>;
  },
  string(): ZodString {
    return {} as ZodString;
  },
  number(): ZodNumber {
    return {} as ZodNumber;
  },
  boolean(): ZodBoolean {
    return {} as ZodBoolean;
  },
  array<T>(item: T): ZodArray<T> {
    return { item } as ZodArray<T>;
  },
  enum<T extends string[]>(values: T): ZodEnum<T> {
    return { values } as ZodEnum<T>;
  },
};

const CreateUserSchema = z.object({
  name: z.string().min(2).max(80).describe('User full name'),
  email: z.string().email(),
  age: z.number().optional(),
  roles: z.array(z.enum(['admin', 'user'])),
  active: z.boolean(),
});

class CreateUserDto extends createZodDto(CreateUserSchema) {}

@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto): string {
    return dto as unknown as string;
  }
}
