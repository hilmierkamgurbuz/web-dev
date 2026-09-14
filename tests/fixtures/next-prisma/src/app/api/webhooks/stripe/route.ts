import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const payload = await req.text()
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  return NextResponse.json({ received: true })
}
