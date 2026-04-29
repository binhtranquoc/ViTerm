import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

export interface AuthPayload {
  accessToken: string
  refreshToken?: string
}

export interface AuthState extends AuthPayload {
  isRefreshing: boolean
}

const initialState: AuthState = {
  accessToken: "",
  refreshToken: "",
  isRefreshing: false,
}

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload
    },
    logout: (state) => {
      state.accessToken = ""
      state.refreshToken = ""
      state.isRefreshing = false
    },
    setAuth: (state, action: PayloadAction<AuthPayload>) => {
      state.accessToken = action.payload.accessToken
      state.refreshToken = action.payload.refreshToken ?? ""
    },
  },
})

export const { setRefreshing, logout, setAuth } = authSlice.actions
export default authSlice.reducer
