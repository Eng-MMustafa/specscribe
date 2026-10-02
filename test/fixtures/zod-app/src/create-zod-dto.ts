/** Local stub for `nestjs-zod` so the fixture does not need extra dependencies. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createZodDto(schema: any): new () => any {
  return class ZodDto {} as unknown as new () => any;
}
