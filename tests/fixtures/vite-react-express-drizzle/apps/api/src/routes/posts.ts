import { Router } from 'express'
import { createPost, deletePost, getPost, listPosts } from '../controllers/posts.controller'
import { requireAuth } from '../middleware/requireAuth'
import { validate } from '../middleware/validate'
import { CreatePostSchema } from '../schemas/post.schema'

const router = Router()

router.get('/', listPosts)
router.get('/:id', getPost)
router.post('/', requireAuth, validate(CreatePostSchema), createPost)
router.delete('/:id', requireAuth, deletePost)

export default router
