import { useMatch } from 'react-router'
import { useMe } from '../api/me'

/* Links to a book, film or note photo. The page they open depends on where
   you share from: from a profile, that person's shelf with the record open
   (and the photo, for a photo); from anywhere else, Explore. The server
   reads the same links to give them a title and a preview card
   (api/app/services/share.py), so keep the two in step. */

export type ShareKind = 'book' | 'film'

export type ShareLink = {
  url: string
  /** the link without https://, for display */
  short: string
  /** what opening it shows, or why it isn't the profile link you might expect */
  note: string
  /** the preview card's address, fetched when sharing so it's ready (and
      cached) before anyone opens the link */
  card: string
  /** whose shelf it opens, if it opens one */
  handle: string | null
  /** set when there's no link to share yet, and what's in the way */
  blocked?: 'shelf' | 'copy'
}

type Copy = { is_public: boolean } | null | undefined

const word = (kind: ShareKind) => (kind === 'book' ? 'book' : 'film')

function build(path: string, params: Record<string, string>): { url: string; short: string } {
  const url = `${window.location.origin}${path}?${new URLSearchParams(params)}`
  return { url, short: url.replace(/^https?:\/\//, '') }
}

/** The link for sharing a record from the page you're on. `theirs` is the
    handle when it's open on someone's profile with their copy; `mine` is
    your own copy, if you have one. */
export function useShareLink(kind: ShareKind, id: string, theirs: string | null, mine: Copy): ShareLink {
  const { data: me } = useMe()
  const onMyProfile = !!useMatch(kind === 'book' ? '/profile' : '/profile/films')
  const films = kind === 'film' ? '/films' : ''
  const explore = { ...build(`/explore${films}`, { [kind]: id }), card: `/og/${kind}/${id}.jpg`, handle: null }

  if (theirs) {
    return { ...build(`/u/${theirs}${films}`, { [kind]: id }), card: `/og/${kind}/${id}.jpg?u=${theirs}`, handle: theirs,
      note: `Opens on @${theirs}'s shelf, with their note and photos.` }
  }
  if (onMyProfile && me && mine) {
    if (!me.is_profile_public) return { ...explore, note: `Your shelf is private, so this link opens the ${word(kind)} on Explore.` }
    if (!mine.is_public) return { ...explore, note: `Your copy is set to Only me, so this link opens the ${word(kind)} on Explore.` }
    return { ...build(`/u/${me.handle}${films}`, { [kind]: id }), card: `/og/${kind}/${id}.jpg?u=${me.handle}`, handle: me.handle,
      note: 'Opens on your shelf, with your note and photos.' }
  }
  return { ...explore, note: `Opens the ${word(kind)} on Explore.` }
}

/** A photo on a note only has a link on a shelf people can see. */
function photoLink(kind: ShareKind, id: string, handle: string, photoId: string): ShareLink {
  const films = kind === 'film' ? '/films' : ''
  return {
    ...build(`/u/${handle}${films}`, { [kind]: id, photo: photoId }),
    card: `/og/photo/${photoId}.jpg`, handle, note: `Opens this photo on @${handle}'s shelf.`,
  }
}

/** Links for the photos on a note: someone else's (`theirs`), or your own
    copy's wherever it's open. Your own photos always get a share button; while
    your shelf or the copy is private, it says what to change instead. */
export function usePhotoLinks(kind: ShareKind, id: string, theirs: string | null, mine: Copy): ((photoId: string) => ShareLink) | undefined {
  const { data: me } = useMe()
  if (theirs) return (photoId) => photoLink(kind, id, theirs, photoId)
  if (!me || !mine) return undefined
  if (!me.is_profile_public || !mine.is_public) {
    const blocked = !me.is_profile_public ? 'shelf' : 'copy'
    const note = blocked === 'shelf'
      ? 'Your shelf is private, so nobody else can open this photo. Make it public to get a link.'
      : 'This copy is set to Only me, so nobody else can open this photo. Set it to Public in your note and save, then share.'
    return () => ({ url: '', short: '', card: '', handle: null, note, blocked })
  }
  return (photoId) => photoLink(kind, id, me.handle, photoId)
}

/** "Stoner by John Williams", "Paris, Texas (1984) by Wim Wenders": the
    same title the link preview shows. */
export function shareTitle(title: string, by?: string | null, year?: string | null) {
  const name = year ? `${title} (${year})` : title
  return by ? `${name} by ${by}` : name
}
