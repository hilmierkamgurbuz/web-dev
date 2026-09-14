import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ContactSchema } from './contact.schema'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const result = ContactSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 400 })
  }
  const message = await prisma.contactMessage.create({ data: result.data })
  return NextResponse.json(message, { status: 201 })
}
