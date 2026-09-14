export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/xml')
  return '<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>'
})
