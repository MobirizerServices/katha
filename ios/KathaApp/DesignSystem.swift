import SwiftUI

// Katha design tokens — dark, video-first (PDD design system, matching
// docs/Katha_iOS_Design_v0.3.html). Single source of truth for the app's look.

public enum Katha {

    public enum Color {
        public static let bg = SwiftUI.Color(hex: 0x0B0B0F)
        public static let surface = SwiftUI.Color(hex: 0x16161D)
        public static let raised = SwiftUI.Color(hex: 0x1F1F28)
        public static let text = SwiftUI.Color(hex: 0xF5F5F7)
        public static let text2 = SwiftUI.Color(hex: 0xA1A1AA)
        public static let accent = SwiftUI.Color(hex: 0xFF5C3A)
        public static let accentPressed = SwiftUI.Color(hex: 0xE04A2B)
        public static let coin = SwiftUI.Color(hex: 0xF5C042)
        public static let success = SwiftUI.Color(hex: 0x2FBF71)
        public static let danger = SwiftUI.Color(hex: 0xFF4D4F)
    }

    public enum Radius {
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let pill: CGFloat = 999
    }

    public enum Spacing {
        public static let xs: CGFloat = 4
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 24
    }
}

extension Color {
    /// 0xRRGGBB integer initializer for the design tokens.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

// MARK: - Reusable components

/// The primary accent call-to-action (Unlock / Buy coins).
struct KathaPrimaryButton: View {
    let title: String
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(enabled ? Katha.Color.accent : Katha.Color.raised)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .disabled(!enabled)
    }
}

/// A coin count with the coin-gold pip, used across paywall and wallet.
struct CoinBadge: View {
    let coins: Int
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(Katha.Color.coin).frame(width: 14, height: 14)
            Text("\(coins)")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
        }
    }
}


/// Left-aligned wrapping layout (mockup 1.3's chip rows): each child keeps its
/// natural size and flows onto the next line when the row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 10

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, in: proposal.width ?? .infinity)
        let height = rows.reduce(CGFloat.zero) { $0 + $1.height } +
            lineSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize,
                       subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, in: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ subviews: Subviews, in maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if !current.indices.isEmpty && needed > maxWidth {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(i)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
