import axios, { AxiosError } from "axios";
import { store } from "@/shared/stores";
// import { setRefreshing, logout, setAuth } from "@/shared/stores/slices/authSlice";
// import { authService } from "@/shared/services/auth/auth.service";
// import { toast } from "sonner";

declare module 'axios' {
    export interface InternalAxiosRequestConfig {
        _retry?: boolean
    }
}


export const publicApi = axios.create({
    baseURL: '/api',
    timeout: 10000,
    headers: {
        'Content-Type' : 'application/json'
    },
    withCredentials: true
})

export const privateApi = axios.create({
    baseURL: '/api',
    timeout: 10000,
    headers: {
        'Content-Type' : 'application/json'
    },
    withCredentials: true
})


//Interceptor
privateApi.interceptors.request.use(
    (config) => {

        const state = store.getState()

        const accessToken = state.auth.accessToken
        if(!accessToken){
            return Promise.reject(new Error("No valid access token found"))
        }
        config.headers.Authorization = `Bearer ${accessToken}`

        /** FORMDATA */
        if(config.data instanceof FormData){
            config.headers["Content-Type"] = 'multipart/form-data'
        }else{
            config.headers["Content-Type"] = 'application/json'
        }
        return config
    },
    (error) => {
        return Promise.reject(error)
    }
)

// TODO: tạm tắt logic refresh token
// let failedQueue: Array<{
//     resolve: (value: string | null) => void,
//     reject: (reason?: unknown) => void
// }> = []
//
// const processQueue = (error: unknown, token: string | null = null) => {
//     failedQueue.forEach((prom) => {
//         if(error){
//             prom.reject(error)
//         }else{
//             prom.resolve(token)
//         }
//     })
//     failedQueue = []
// }

publicApi.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        return Promise.reject(error)
    }
)

privateApi.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {

        if(!error.config) return Promise.reject(error)

        const originalRequest = error.config

        if(!originalRequest) return Promise.reject(error)

        // TODO: tạm tắt logic refresh token để debug luồng auth hiện tại
        // if(error.response?.status === 401 &&
        //     !originalRequest._retry &&
        //     !originalRequest?.url?.includes('/v1/auth/refresh')
        // ){
        //     originalRequest._retry = true
        //     const isRefresing = store.getState().auth.isRefreshing
        //     if(isRefresing){
        //         return new Promise((resolve, reject) => {
        //             failedQueue.push({resolve, reject})
        //         }).then((token) => {
        //             if(token && originalRequest){
        //                 originalRequest.headers.Authorization = `Bearer ${token}`
        //                 return privateApi(originalRequest)
        //             }
        //             return Promise.reject(error)
        //         }).catch((err) => Promise.reject(err))
        //     }
        //
        //     store.dispatch(setRefreshing(true))
        //     try {
        //         const response = await authService.refresh()
        //         if(response.status && response.code === 200 && 'data' in response){
        //             store.dispatch(setAuth(response.data))
        //             const newToken = response.data.accessToken
        //             originalRequest.headers.Authorization = `Bearer ${newToken}`
        //             processQueue(null, newToken)
        //             return privateApi(originalRequest)
        //         }
        //         throw new Error("Refresh Token thất bại")
        //     } catch (refreshError) {
        //         store.dispatch(logout())
        //         processQueue(refreshError, null)
        //         window.location.href = "/admin"
        //         return Promise.reject(refreshError)
        //     } finally {
        //         store.dispatch(setRefreshing(false))
        //     }
        // }

        return Promise.reject(error)
    }
)
