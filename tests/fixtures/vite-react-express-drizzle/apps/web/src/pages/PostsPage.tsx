import { PostList } from '../components/PostList'
import { usePosts } from '../features/posts/usePosts'

export function PostsPage() {
  const posts = usePosts()
  return (
    <div>
      <h1>Posts</h1>
      <PostList posts={posts} />
    </div>
  )
}
