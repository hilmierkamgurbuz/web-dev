import { useParams } from 'react-router-dom'
import { CommentForm } from '../components/CommentForm'
import { useComments, usePost } from '../features/posts/usePosts'

export function PostDetailPage() {
  const { id } = useParams()
  const post = usePost(id ?? '')
  const comments = useComments(id ?? '')
  return (
    <div>
      {post && <h1>{(post as { title: string }).title}</h1>}
      <CommentForm postId={id ?? ''} />
      <ul>
        {comments.map((comment: { id: number; body: string }) => (
          <li key={comment.id}>{comment.body}</li>
        ))}
      </ul>
    </div>
  )
}
