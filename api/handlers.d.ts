// Type declarations for the serverless API handlers so that both the
// local `tsc --noEmit` (if ever pointed at api/) and Vercel's remote
// type validation stay clean. Handlers are plain (req, res) functions.
declare module './bp.mjs' {
  const handler: (req: unknown, res: unknown) => Promise<void>
  export default handler
}
declare module './jup.mjs' {
  const handler: (req: unknown, res: unknown) => Promise<void>
  export default handler
}
declare module './lend.mjs' {
  const handler: (req: unknown, res: unknown) => Promise<void>
  export default handler
}
declare module './uniswap.mjs' {
  const handler: (req: unknown, res: unknown) => Promise<void>
  export default handler
}
declare module './pancake.mjs' {
  const handler: (req: unknown, res: unknown) => Promise<void>
  export default handler
}
