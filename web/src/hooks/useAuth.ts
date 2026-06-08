import { useState, useEffect, useCallback } from 'react'
import * as api from '../lib/api'

type User = { id: string; email: string }

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('storm_user')
    return stored ? JSON.parse(stored) : null
  })
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('storm_token')
  )

  useEffect(() => {
    if (token) {
      localStorage.setItem('storm_token', token)
    } else {
      localStorage.removeItem('storm_token')
    }
  }, [token])

  useEffect(() => {
    if (user) {
      localStorage.setItem('storm_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('storm_user')
    }
  }, [user])

  const isAuthenticated = !!token && !!user

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password)
      setToken(res.token)
      setUser(res.user)
    },
    []
  )

  const handleRegister = useCallback(
    async (email: string, password: string) => {
      const res = await api.register(email, password)
      setToken(res.token)
      setUser(res.user)
    },
    []
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  return { user, token, isAuthenticated, login: handleLogin, register: handleRegister, logout }
}
