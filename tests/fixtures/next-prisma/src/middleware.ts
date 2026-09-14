import { auth } from '@/auth'

export default auth((req) => {
  return undefined
})

export const config = {
  matcher: ['/orders/:path*'],
}
