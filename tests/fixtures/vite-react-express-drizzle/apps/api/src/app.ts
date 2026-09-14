import express from 'express'
import commentsRouter from './routes/comments'
import postsRouter from './routes/posts'

const app = express()

app.use(express.json())
app.use('/api/posts', postsRouter)
app.use('/api/posts', commentsRouter)
app.get('/health', (req, res) => res.json({ ok: true }))

export default app
