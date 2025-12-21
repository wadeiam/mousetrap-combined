import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case forbidden
    case notFound
    case badRequest(message: String?)
    case serverError(statusCode: Int, message: String?)
    case networkError(Error)
    case decodingError(Error)
    case invalidResponse
    case twoFactorRequired
    case noData

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Session expired. Please login again."
        case .forbidden:
            return "You don't have permission to perform this action."
        case .notFound:
            return "The requested resource was not found."
        case .badRequest(let message):
            return message ?? "Invalid request."
        case .serverError(_, let message):
            return message ?? "A server error occurred. Please try again."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Failed to process server response: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid server response."
        case .twoFactorRequired:
            return "Two-factor authentication required."
        case .noData:
            return "No data received from server."
        }
    }

    var isAuthError: Bool {
        switch self {
        case .unauthorized, .twoFactorRequired:
            return true
        default:
            return false
        }
    }
}
