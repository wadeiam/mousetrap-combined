import Foundation
import Combine

class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            // Try ISO8601 with fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                return date
            }

            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date: \(dateString)"
            )
        }

        self.encoder = JSONEncoder()
    }

    // MARK: - Generic Request Methods

    func request<T: Decodable>(
        endpoint: APIEndpoint,
        method: HTTPMethod = .get,
        body: Encodable? = nil,
        queryItems: [URLQueryItem]? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        var urlComponents = URLComponents(url: endpoint.url, resolvingAgainstBaseURL: false)!
        urlComponents.queryItems = queryItems

        guard let url = urlComponents.url else {
            throw APIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if required
        if requiresAuth, let token = KeychainService.shared.getAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Add tenant ID header
        if let tenantId = KeychainService.shared.getCurrentTenantId() {
            request.setValue(tenantId, forHTTPHeaderField: "X-Tenant-ID")
        }

        // Add body
        if let body = body {
            request.httpBody = try encoder.encode(body)
        }

        #if DEBUG
        print("[API] \(method.rawValue) \(url)")
        #endif

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

            #if DEBUG
            print("[API] Response: \(httpResponse.statusCode)")
            if let json = String(data: data, encoding: .utf8) {
                print("[API] Body: \(json.prefix(500))")
            }
            #endif

            // Handle error status codes
            switch httpResponse.statusCode {
            case 200...299:
                break // Success
            case 401:
                // Check if 2FA required
                if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data),
                   errorResponse.error == "2FA_REQUIRED" {
                    throw APIError.twoFactorRequired
                }
                throw APIError.unauthorized
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            case 400:
                let errorResponse = try? decoder.decode(ErrorResponse.self, from: data)
                throw APIError.badRequest(message: errorResponse?.error)
            default:
                let errorResponse = try? decoder.decode(ErrorResponse.self, from: data)
                throw APIError.serverError(statusCode: httpResponse.statusCode, message: errorResponse?.error)
            }

            // Decode response
            return try decoder.decode(T.self, from: data)

        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - Convenience Methods

    func get<T: Decodable>(
        endpoint: APIEndpoint,
        queryItems: [URLQueryItem]? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        try await request(endpoint: endpoint, method: .get, queryItems: queryItems, requiresAuth: requiresAuth)
    }

    func post<T: Decodable>(
        endpoint: APIEndpoint,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        try await request(endpoint: endpoint, method: .post, body: body, requiresAuth: requiresAuth)
    }

    func put<T: Decodable>(
        endpoint: APIEndpoint,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        try await request(endpoint: endpoint, method: .put, body: body, requiresAuth: requiresAuth)
    }

    func patch<T: Decodable>(
        endpoint: APIEndpoint,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws -> T {
        try await request(endpoint: endpoint, method: .patch, body: body, requiresAuth: requiresAuth)
    }

    func delete<T: Decodable>(
        endpoint: APIEndpoint,
        requiresAuth: Bool = true
    ) async throws -> T {
        try await request(endpoint: endpoint, method: .delete, requiresAuth: requiresAuth)
    }

    // For requests that don't return data
    func postVoid(
        endpoint: APIEndpoint,
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws {
        let _: EmptyResponse = try await request(endpoint: endpoint, method: .post, body: body, requiresAuth: requiresAuth)
    }
}

// MARK: - Supporting Types

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct ErrorResponse: Codable {
    let error: String?
    let message: String?
    let success: Bool?
}

struct EmptyResponse: Codable {}
