import type { NextFunction, Request, Response } from 'express'

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
