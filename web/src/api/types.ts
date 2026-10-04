// Friendly names for the generated schema. Regenerate schema.d.ts with
// `npm run gen:api` whenever a FastAPI response model changes.
import type { components } from './schema'

type Schemas = components['schemas']

export type Book = Schemas['BookRead']
export type Author = Schemas['AuthorSchema']
export type Cover = Schemas['CoverSchema']
export type UserBookImage = Schemas['UserBookImageRead']
export type UpdateUserBookRequest = Schemas['UpdateUserBookRequest']
export type BatchUserBookRequest = Schemas['BatchUserBookRequest']
export type ManualBookCreate = Schemas['ManualBookCreate']
export type SearchBookMetadata = Schemas['SearchBookMetadata']
