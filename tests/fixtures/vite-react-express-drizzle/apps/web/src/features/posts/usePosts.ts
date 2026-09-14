import { useEffect, useState } from 'react'
import { api } from '../../api/http'

export function usePosts() {
  const [posts, setPosts] = useState([])

  useEffect(() => {
    api.get('/api/posts').then((res) => setPosts(res.data))
  }, [])

  return posts
}

export function usePost(id: string) {
  const [post, setPost] = useState(null)

  useEffect(() => {
    api.get(`/api/posts/${id}`).then((res) => setPost(res.data))
  }, [id])

  return post
}

export async function createPost(body: { title: string; body: string }) {
  const res = await api.post('/api/posts', body)
  return res.data
}

export async function deletePost(id: string) {
  const res = await api.delete(`/api/posts/${id}`)
  return res.data
}

export async function updatePost(id: string, body: { title: string; body: string }) {
  const res = await api.put(`/api/posts/${id}`, body)
  return res.data
}

export function useComments(postId: string) {
  const [comments, setComments] = useState([])

  useEffect(() => {
    api.get(`/api/posts/${postId}/comments`).then((res) => setComments(res.data))
  }, [postId])

  return comments
}

export async function createComment(postId: string, body: { body: string }) {
  const res = await api.post(`/api/posts/${postId}/comments`, body)
  return res.data
}
