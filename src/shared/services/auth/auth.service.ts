import axios from "axios";

interface RefreshData {
  accessToken: string;
  refreshToken?: string;
}

interface RefreshResponse {
  status: boolean;
  code: number;
  data: RefreshData;
}

const authApi = axios.create({
  baseURL: "/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

export const authService = {
  refresh: async (): Promise<RefreshResponse> => {
    const response = await authApi.post<RefreshResponse>("/v1/auth/refresh");
    return response.data;
  },
};
