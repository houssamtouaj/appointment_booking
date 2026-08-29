/**
 * Every schema, one import path. Screens import the *types* from `@/types`;
 * this barrel is for the places that need the runtime schema — a resolver, a
 * `.parse()` at an API boundary, `contract:check`.
 */
export * from '@/api/schemas/auth'
export * from '@/api/schemas/common'
export * from '@/api/schemas/invitation'
export * from '@/api/schemas/problem'
