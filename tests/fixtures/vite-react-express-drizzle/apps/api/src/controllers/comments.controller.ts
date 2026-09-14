import { eq } from 'drizzle-orm'
import type { Request, Response } from 'express'
import { db } from '../db/client'
import { comments } from '../db/schema'

export async function listComments(req: Request, res: Response) {
  const postId = Number(req.params.postId)
  const rows = await db.select().from(comments).where(eq(comments.postId, postId))
  res.json(rows)
}

export async function createComment(req: Request, res: Response) {
  const postId = Number(req.params.postId)
  const [row] = await db
    .insert(comments)
    .values({ ...req.body, postId })
    .returning()
  res.status(201).json(row)
}
