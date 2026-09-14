import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        if (!credentials?.email) {
          return null
        }
        return { id: 'user_1', email: String(credentials.email) }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
})
