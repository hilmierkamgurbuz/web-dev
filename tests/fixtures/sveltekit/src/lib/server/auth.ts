export function requireUser(locals: App.Locals) {
  if (!locals.user) {
    throw new Error('Unauthorized')
  }
  return locals.user
}
