import Foundation

extension Date {
    /// Returns a relative time string like "2 min ago", "3 hours ago", "Yesterday"
    var relativeString: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    /// Returns a full relative string like "2 minutes ago"
    var relativeStringFull: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    /// Returns formatted time like "2:30 PM"
    var timeString: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: self)
    }

    /// Returns formatted date like "Dec 15, 2024"
    var dateString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: self)
    }

    /// Returns formatted date and time
    var dateTimeString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: self)
    }

    /// Check if date is today
    var isToday: Bool {
        Calendar.current.isDateInToday(self)
    }

    /// Check if date is yesterday
    var isYesterday: Bool {
        Calendar.current.isDateInYesterday(self)
    }

    /// Smart date string: "Today 2:30 PM", "Yesterday 5:00 PM", or "Dec 15, 2:30 PM"
    var smartString: String {
        if isToday {
            return "Today \(timeString)"
        } else if isYesterday {
            return "Yesterday \(timeString)"
        } else {
            return dateTimeString
        }
    }
}

extension TimeInterval {
    /// Format seconds as uptime string like "2d 5h" or "3h 25m"
    var uptimeString: String {
        let hours = Int(self) / 3600
        let minutes = (Int(self) % 3600) / 60

        if hours >= 24 {
            let days = hours / 24
            let remainingHours = hours % 24
            return "\(days)d \(remainingHours)h"
        } else if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else {
            return "\(minutes)m"
        }
    }
}
