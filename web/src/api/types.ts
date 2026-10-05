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

// JSON endpoints for the React app (api/app/routers/web.py)
export type CatalogEntry = Schemas['CatalogEntry']
export type ShelfEntry = Schemas['ShelfEntry']
export type Haul = Schemas['Haul']
export type ShelfCounts = Schemas['ShelfCounts']
export type ShelfOwner = Schemas['ShelfOwner']
export type ShelfRead = Schemas['ShelfRead']
export type PublicShelfRead = Schemas['PublicShelfRead']
export type RecentPage = Schemas['RecentPage']
export type BookEntryRead = Schemas['BookEntryRead']
export type LoginRequest = Schemas['LoginRequest']
export type SignupRequest = Schemas['SignupRequest']
