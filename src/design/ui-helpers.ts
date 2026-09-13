export { cn } from '../lib/format'
export { blocks } from '../lib/format'

/** StonkFun serves some asset paths relative to its origin — normalize them.
 *  data:/blob: URLs (uploaded logo previews) pass through untouched. */
export function sfAssetUrlSafe(path: string): string {
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) return path
  return 'https://www.stonkfun.xyz' + path
}
