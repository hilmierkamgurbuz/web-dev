import { PostItem } from './PostItem'

type Post = { id: number; title: string; body: string }

export function PostList({ posts }: { posts: Post[] }) {
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          <PostItem post={post} />
        </li>
      ))}
    </ul>
  )
}
