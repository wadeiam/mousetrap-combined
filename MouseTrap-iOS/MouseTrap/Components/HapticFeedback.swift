import SwiftUI
import UIKit

// MARK: - Haptic Feedback Manager

enum HapticFeedback {
    case light
    case medium
    case heavy
    case success
    case warning
    case error
    case selection

    func trigger() {
        switch self {
        case .light:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .medium:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .heavy:
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case .success:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .error:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .selection:
            UISelectionFeedbackGenerator().selectionChanged()
        }
    }
}

// MARK: - View Modifier

struct HapticModifier: ViewModifier {
    let feedback: HapticFeedback

    func body(content: Content) -> some View {
        content.onTapGesture {
            feedback.trigger()
        }
    }
}

extension View {
    func haptic(_ feedback: HapticFeedback) -> some View {
        self.modifier(HapticModifier(feedback: feedback))
    }

    func hapticOnTap(_ feedback: HapticFeedback = .light, action: @escaping () -> Void) -> some View {
        self.onTapGesture {
            feedback.trigger()
            action()
        }
    }
}

// MARK: - Button with Haptic

struct HapticButton<Label: View>: View {
    let feedback: HapticFeedback
    let action: () -> Void
    let label: () -> Label

    init(
        feedback: HapticFeedback = .light,
        action: @escaping () -> Void,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self.feedback = feedback
        self.action = action
        self.label = label
    }

    var body: some View {
        Button {
            feedback.trigger()
            action()
        } label: {
            label()
        }
    }
}
