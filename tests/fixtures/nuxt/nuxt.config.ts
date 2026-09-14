export default defineNuxtConfig({
  modules: ['nuxt-auth-utils'],
  runtimeConfig: {
    session: {
      password: process.env.NUXT_SESSION_PASSWORD,
    },
    public: {
      siteName: 'Todo App',
    },
  },
})
