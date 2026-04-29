interface IBaseReponse {
  status: boolean,
  code: number,
  message: string,
  timestamp: string
}

export interface IApiSuccessResponse<T> extends IBaseReponse{
  data: T
}

export interface IApiErrorResponse<E> extends IBaseReponse {
  errors: E
}

export interface IApiMessageResponse extends IBaseReponse{
  message: string
}


export type IApiResponse<T, E> = IApiSuccessResponse<T> | IApiErrorResponse<E> | IApiMessageResponse