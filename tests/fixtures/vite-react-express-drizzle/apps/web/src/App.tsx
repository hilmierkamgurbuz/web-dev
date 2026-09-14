import { Route, Routes } from 'react-router-dom'
import { PostDetailPage } from './pages/PostDetailPage'
import { PostsPage } from './pages/PostsPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PostsPage />} />
      <Route path="/posts/:id" element={<PostDetailPage />} />
    </Routes>
  )
}
