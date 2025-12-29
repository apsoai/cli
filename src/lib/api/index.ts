/**
 * Platform API Module
 *
 * Exports API client, types, and service functions.
 */

export * from "./types";
export { ApiClient, createApiClient, WorkspaceSummary, ServiceSummary, ServiceEnvironment } from "./client";
// Note: services.ts uses api object from incoming branch which doesn't exist in HEAD
// Uncomment when services.ts is adapted to use ApiClient class
// export {
//   authApi,
//   workspacesApi,
//   servicesApi,
//   schemaApi,
//   buildApi,
//   githubApi,
// } from "./services";
