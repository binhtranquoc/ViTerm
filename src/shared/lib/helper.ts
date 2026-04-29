import { AxiosError } from "axios"
import { toast } from "sonner"
import { IApiErrorResponse, IApiMessageResponse, IApiResponse, IApiSuccessResponse } from "@/shared/interfaces/goApiResponse"

export const handleApiError = (error: unknown) => {
    if(error instanceof AxiosError){
        if(error.response){
            const errorReponse = error.response.data
            if(errorReponse.message){
                toast.error(errorReponse.message)
            }else{
                toast.error(`Error: ${error.response.status}`)
            }
        }else if(error.request){
            toast.error("No response received from server")
        }else{
            toast.error("Failed to send request")
        }
    }else{
        toast.error("Unknown error")
    }
}

export const buildUrlWithQueryString = (endpoint: string, queryParams?: Record<string, string>) => {
    const basePath = `${endpoint}`
    if(!queryParams) return basePath

    const queryString = new URLSearchParams(queryParams).toString()
    return `${basePath}${queryString ? `?${queryString}` : ""}`
}

export const isSuccessResponse = <T, E>(response: IApiResponse<T, E> | undefined): response is IApiSuccessResponse<T> => {
   return Boolean(response && 'data' in response && response.status === true)
}

export const isErrorResponse = <T, E>(response: IApiResponse<T, E> | undefined): response is IApiErrorResponse<E> => {
    return Boolean(response && 'errors' in response && response.status === false)
}

export const isMessageResponse = <T, E>(response: IApiResponse<T, E> | undefined): response is IApiMessageResponse => {
    return Boolean(response && !('data' in response) && !('errors' in response))
}