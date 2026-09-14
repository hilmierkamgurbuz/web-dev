import { Router } from 'express'
import { createComment, listComments } from '../controllers/comments.controller'

const router = Router()

router.route('/:postId/comments').get(listComments).post(createComment)

export default router
