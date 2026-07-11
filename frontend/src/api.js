const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, '')

export const apiUrl = (path) => {
  if (!path) return API_BASE_URL || '/'
  if (/^(https?:|blob:|data:)/i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

export const assetUrl = apiUrl

export const apiFetch = (path, options) => fetch(apiUrl(path), options)
