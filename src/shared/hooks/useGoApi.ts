import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { baseService } from "@/shared/services/goApiService"
import { IApiResponse, IApiMessageResponse } from "@/shared/interfaces/goApiResponse"
import { toast } from "sonner"
import { buildUrlWithQueryString } from "@/shared/lib/helper"



const useApi = () => {

    const queryClient = useQueryClient()

    const usePaginate = <T>(
        endpoint: string,
        queryParams?: Record<string, string>,
        options?: { enabled?: boolean }
    ) => {
        const fullUrl = buildUrlWithQueryString(endpoint, queryParams)
        
        return useQuery<IApiResponse<T, unknown>, Error>({
            queryKey: [endpoint, queryParams],
            queryFn: () => {
                return baseService.paginate<T>(fullUrl);
            },
            enabled: options?.enabled ?? true
        })
    }

    const useShow = <T>(endpoint: string, id: number, options: { enable?: boolean }) => {
        return useQuery<IApiResponse<T, unknown>, Error>({
            queryKey: [endpoint, id],
            queryFn: () => baseService.show<T>(endpoint, id),
            enabled: options.enable ?? true
        })
    }

    const useCreate = <T, P>(endpoint: string) => {
        return useMutation<IApiResponse<T, unknown>, Error, P>({
            mutationFn: (payload: P) => baseService.create<T, P>(endpoint, payload),
            onSuccess: () => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
            },
            onError: (error) => {
                toast.error(`Failed to create record: ${error.message}`)
            }
        })
    }

    const useUpdate = <T, P>(endpoint: string, id: number) => {
        return useMutation<IApiResponse<T, unknown>, Error, P>({
            mutationFn: (payload: P) => baseService.update<T, P>(endpoint, id, payload),
            onSuccess: (response) => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
                queryClient.invalidateQueries({queryKey: [endpoint, id]})
                
                toast.success(response.message)
            },
            onError: (error) => {
                toast.error(`Failed to update record: ${error.message}`)
            }
        })
    }

    const useUpdatePost = <T, P>(endpoint: string, id: number) => {
        return useMutation<IApiResponse<T, unknown>, Error, P>({
            mutationFn: (payload: P) => baseService.updatePost<T, P>(endpoint, id, payload),
            onSuccess: (response) => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
                queryClient.invalidateQueries({queryKey: [endpoint, id]})
                
                toast.success(response.message)
            },
            onError: (error) => {
                toast.error(`Failed to update record: ${error.message}`)
            }
        })
    }

    const usePatchUpdate = <T, P>(endpoint: string) => {
        return useMutation<IApiResponse<T, unknown>, Error, { payload: P, id: number }>({
            mutationFn: ({payload, id}) => baseService.patch<T, P>(endpoint, id, payload),
            onSuccess: (response, variables) => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
                queryClient.invalidateQueries({queryKey: [endpoint, variables.id]})
                
                toast.success(response.message)
            },
            onError: (error) => {
                toast.error(`Failed to update record: ${error.message}`)
            }
        })
    }

    const useDelete = (endpoint: string) => {
        return useMutation<IApiMessageResponse, Error, number>({
            mutationFn: (id) => baseService.delete(endpoint, id),
            onSuccess: (response) => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
                toast.success(response.message)
            },
            onError: (error) => {
                toast.error(`Failed to delete record: ${error.message}`)
            }
        })
    }

    const useBulkDelete = (endpoint: string, ids: number[]) => {
        return useMutation<IApiMessageResponse, Error, unknown>({
            mutationFn: () => baseService.bulkDelete(endpoint, ids),
            onSuccess: (response) => {
                queryClient.invalidateQueries({queryKey: [endpoint], exact: true})
                toast.success(response.message)
            },
            onError: (error) => {
                toast.error(`Failed to bulk delete records: ${error.message}`)
            }
        })
    }


    return {
        usePaginate,
        useShow,
        useCreate,
        useUpdate,
        useDelete,
        useBulkDelete,
        usePatchUpdate,
        useUpdatePost
    }


}


export default useApi
