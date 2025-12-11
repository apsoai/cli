import { expect, describe, it, beforeEach, jest } from '@jest/globals';

// Mock axios module BEFORE importing ApiClient
const mockAxiosInstance: any = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  interceptors: {
    request: {
      use: jest.fn(),
    },
    response: {
      use: jest.fn(),
    },
  },
};

const mockAxiosCreate = jest.fn(() => mockAxiosInstance);

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockAxiosCreate,
  },
}));

// Mock config manager BEFORE importing ApiClient
jest.mock('../../src/lib/config', () => ({
  configManager: {
    getToken: jest.fn(() => 'mock-token'),
  },
}));

// Now import ApiClient after mocks are set up
import { ApiClient, ApiClientError } from '../../src/lib/api-client';

describe('ApiClient', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockAxiosCreate.mockReturnValue(mockAxiosInstance);
    apiClient = new ApiClient('https://api.test.com');
  });

  describe('constructor', () => {
    it('should create axios instance with correct base URL', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.test.com',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        })
      );
    });
  });

  describe('get', () => {
    it('should make GET request and return data', async () => {
      const mockResponse = { data: { id: 1, name: 'Test' } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.get('/test');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', undefined);
      expect(result).toEqual(mockResponse.data);
    });

    it('should pass config to axios get', async () => {
      const mockResponse = { data: { id: 1 } };
      const config = { params: { id: 1 } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await apiClient.get('/test', config);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/test', config);
    });
  });

  describe('post', () => {
    it('should make POST request and return data', async () => {
      const mockResponse = { data: { id: 1, name: 'Created' } };
      const requestData = { name: 'Test' };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await apiClient.post('/test', requestData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/test', requestData, undefined);
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('error handling', () => {
    it('should throw ApiClientError for 401 status', async () => {
      const error = {
        response: {
          status: 401,
          data: {
            error: {
              code: 'AUTH_REQUIRED',
              message: 'Authentication required',
            },
          },
        },
      };

      // Set up the response interceptor to handle the error
      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      mockAxiosInstance.get.mockRejectedValue(error);

      // Call the interceptor error handler directly
      await expect(
        Promise.reject(error).catch(responseInterceptor)
      ).rejects.toThrow(ApiClientError);
    });

    it('should throw ApiClientError for network errors', async () => {
      const error = {
        request: {},
        message: 'Network Error',
      };

      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(
        Promise.reject(error).catch(responseInterceptor)
      ).rejects.toThrow(ApiClientError);
    });

    it('should throw ApiClientError for other errors', async () => {
      const error = {
        response: {
          status: 500,
          data: {
            error: {
              code: 'SERVER_ERROR',
              message: 'Internal server error',
            },
          },
        },
      };

      const responseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      mockAxiosInstance.get.mockRejectedValue(error);

      await expect(
        Promise.reject(error).catch(responseInterceptor)
      ).rejects.toThrow(ApiClientError);
    });
  });

  describe('getBaseUrl', () => {
    it('should return the base URL', () => {
      const client = new ApiClient('https://custom.api.com');
      expect(client.getBaseUrl()).toBe('https://custom.api.com');
    });
  });
});
