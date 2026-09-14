import { request } from '@/lib/api-client'

export function getProfile() {
  return request('/api/profile')
}

function buildPath() {
  const resource = 'profile'
  const version = 'v2'
  return `/api/${resource}/${version}`
}

export function getProfileDynamic() {
  return request(buildPath())
}
