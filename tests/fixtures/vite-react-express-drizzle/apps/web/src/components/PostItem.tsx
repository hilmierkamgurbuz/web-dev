import { Link } from 'react-router-dom'

type Post = { id: number; title: string; body: string }

export function PostItem({ post }: { post: Post }) {
  return (
    <div>
      <Link to={`/posts/${post.id}`}>{post.title}</Link>
      <p>{post.body}</p>
    </div>
  )
}
