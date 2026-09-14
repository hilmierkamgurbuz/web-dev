import { useState } from 'react'
import type { FormEvent } from 'react'
import { createComment } from '../features/posts/usePosts'

export function CommentForm({ postId }: { postId: string }) {
  const [body, setBody] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await createComment(postId, { body })
    setBody('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="submit">Add comment</button>
    </form>
  )
}
