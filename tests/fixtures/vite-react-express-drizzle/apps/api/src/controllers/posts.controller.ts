import { eq } from 'drizzle-orm'
import type { Request, Response } from 'express'
import { db } from '../db/client'
import { posts } from '../db/schema'

export async function listPosts(req: Request, res: Response) {
  const rows = await db.select().from(posts)
  res.json(rows)
}

export async function getPost(req: Request, res: Response) {
  const id = Number(req.params.id)
  const [row] = await db.select().from(posts).where(eq(posts.id, id))
  if (!row) {
    return res.status(404).json({ error: 'Not found' })
  }
  res.json(row)
}

export async function createPost(req: Request, res: Response) {
  const [row] = await db.insert(posts).values(req.body).returning()
  res.status(201).json(row)
}

export async function deletePost(req: Request, res: Response) {
  const id = Number(req.params.id)
  await db.delete(posts).where(eq(posts.id, id))
  res.status(204).send()
}
