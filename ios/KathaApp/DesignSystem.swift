import SwiftUI
import UIKit

// Katha design tokens — dark, video-first (PDD design system, matching
// docs/Katha_iOS_Design_v0.3.html). Single source of truth for the app's look.

public enum Katha {

    /// Warm ember darks — lamplight and single-screen cinema, not the blue-black
    /// every streaming template ships. Sindoor accent + marigold coin unchanged:
    /// those two were already Katha's.
    public enum Color {
        public static let bg = SwiftUI.Color(hex: 0x0F0B09)
        public static let surface = SwiftUI.Color(hex: 0x1A1310)
        public static let raised = SwiftUI.Color(hex: 0x261C16)
        public static let text = SwiftUI.Color(hex: 0xF7F2EC)
        public static let text2 = SwiftUI.Color(hex: 0xB5A89C)
        public static let accent = SwiftUI.Color(hex: 0xFF5C3A)
        public static let accentPressed = SwiftUI.Color(hex: 0xE04A2B)
        public static let coin = SwiftUI.Color(hex: 0xF5C042)
        public static let success = SwiftUI.Color(hex: 0x2FBF71)
        public static let danger = SwiftUI.Color(hex: 0xFF4D4F)
    }

    /// The type voices. Display is condensed-heavy (hand-painted film-poster
    /// energy) for titles; the wordmark is a literary serif italic; section
    /// labels run in small caps (a glyph feature — accessibility labels and
    /// UI-test string matching keep the original text).
    ///
    /// Every size here is a *design* size, quoted at the default (Large) content
    /// size, and every one of them scales with Dynamic Type: the display face
    /// through `Font.custom(_:size:relativeTo:)`, the system faces through the
    /// `.kathaFont(_:)` modifier below (SwiftUI has no `system(size:relativeTo:)`,
    /// so the modifier reads `\.dynamicTypeSize` and re-resolves the point size
    /// itself — which is also what makes it re-render when the setting changes).
    public enum Font {
        /// Anton (OFL, bundled) — the same face the site and the key art use.
        /// Scales on the large-title curve, which is gentle enough that a
        /// 42 pt billboard title stays inside its card at accessibility sizes.
        public static func display(_ size: CGFloat,
                                   relativeTo style: SwiftUI.Font.TextStyle = .largeTitle) -> SwiftUI.Font {
            .custom("Anton-Regular", size: size, relativeTo: style)
        }

        /// The text style whose Dynamic Type curve a given design size rides.
        /// Picking it from the size means no call site has to name one, and a
        /// 40 pt balance grows far less violently than an 11 pt caption — the
        /// same proportions Apple's own styles use.
        static func textStyle(for size: CGFloat) -> SwiftUI.Font.TextStyle {
            switch size {
            case 34...: return .largeTitle
            case 26..<34: return .title
            case 21..<26: return .title2
            case 19..<21: return .title3
            case 16..<19: return .body
            case 14..<16: return .subheadline
            case 12..<14: return .footnote
            case 11..<12: return .caption
            default: return .caption2
            }
        }
    }

    public enum Radius {
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 22
        public static let xxl: CGFloat = 28
        public static let pill: CGFloat = 999
    }

    public enum Spacing {
        public static let xs: CGFloat = 4
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 24
    }

    /// One spring vocabulary for the whole app — every animated state change
    /// uses these, so the app moves like one object, not twelve screens.
    public enum Motion {
        public static let spring = Animation.spring(response: 0.38, dampingFraction: 0.82)
        public static let snappy = Animation.spring(response: 0.26, dampingFraction: 0.86)
    }
}

// MARK: - Dynamic Type

extension Katha {
    /// The largest multiple of a design size we will ever draw. Accessibility
    /// sizes would otherwise take a 42 pt billboard title past 100 pt and push
    /// every neighbouring element off screen; 1.8× keeps the type legible AND
    /// the layout intact, which is the point of supporting the setting at all.
    static let maxTypeScale: CGFloat = 1.8

    /// A design point size resolved for the current content size category.
    static func scaled(_ size: CGFloat,
                       relativeTo style: SwiftUI.Font.TextStyle,
                       typeSize: DynamicTypeSize) -> CGFloat {
        let traits = UITraitCollection(preferredContentSizeCategory: contentSize(typeSize))
        let value = UIFontMetrics(forTextStyle: uiTextStyle(style))
            .scaledValue(for: size, compatibleWith: traits)
        return min(value, size * maxTypeScale)
    }

    static func contentSize(_ size: DynamicTypeSize) -> UIContentSizeCategory {
        switch size {
        case .xSmall: return .extraSmall
        case .small: return .small
        case .medium: return .medium
        case .large: return .large
        case .xLarge: return .extraLarge
        case .xxLarge: return .extraExtraLarge
        case .xxxLarge: return .extraExtraExtraLarge
        case .accessibility1: return .accessibilityMedium
        case .accessibility2: return .accessibilityLarge
        case .accessibility3: return .accessibilityExtraLarge
        case .accessibility4: return .accessibilityExtraExtraLarge
        case .accessibility5: return .accessibilityExtraExtraExtraLarge
        @unknown default: return .large
        }
    }

    static func uiTextStyle(_ style: SwiftUI.Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .largeTitle: return .largeTitle
        case .title: return .title1
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .body: return .body
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption1
        case .caption2: return .caption2
        @unknown default: return .body
        }
    }
}

/// A system font at a design point size that follows Dynamic Type. Reading
/// `\.dynamicTypeSize` here is deliberate: it is what invalidates the view when
/// the reader changes the setting, which a plain `Font` value cannot do.
struct KathaScaledFont: ViewModifier {
    @Environment(\.dynamicTypeSize) private var typeSize
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design
    let style: Font.TextStyle
    let monospacedDigit: Bool
    let smallCaps: Bool

    func body(content: Content) -> some View {
        var font = Font.system(size: Katha.scaled(size, relativeTo: style, typeSize: typeSize),
                               weight: weight, design: design)
        if monospacedDigit { font = font.monospacedDigit() }
        if smallCaps { font = font.smallCaps() }
        return content.font(font)
    }
}

/// A fixed frame whose numbers grow with the text they wrap — the row heights,
/// icon tiles and pills that would otherwise clip their own labels.
struct KathaScaledFrame: ViewModifier {
    @Environment(\.dynamicTypeSize) private var typeSize
    let width: CGFloat?
    let height: CGFloat?
    let alignment: Alignment
    let style: Font.TextStyle

    func body(content: Content) -> some View {
        content.frame(width: width.map { Katha.scaled($0, relativeTo: style, typeSize: typeSize) },
                      height: height.map { Katha.scaled($0, relativeTo: style, typeSize: typeSize) },
                      alignment: alignment)
    }
}

extension View {
    /// The house replacement for `.font(.system(size:…))`: same design size,
    /// but it scales. `relativeTo` defaults to the curve that suits the size.
    func kathaFont(_ size: CGFloat,
                   weight: Font.Weight = .regular,
                   design: Font.Design = .default,
                   relativeTo style: Font.TextStyle? = nil,
                   monospacedDigit: Bool = false,
                   smallCaps: Bool = false) -> some View {
        modifier(KathaScaledFont(size: size, weight: weight, design: design,
                                 style: style ?? Katha.Font.textStyle(for: size),
                                 monospacedDigit: monospacedDigit, smallCaps: smallCaps))
    }

    /// Section labels: small caps, semibold, scaling.
    func kathaLabel(_ size: CGFloat = 13) -> some View {
        kathaFont(size, weight: .semibold, smallCaps: true)
    }

    /// A frame whose fixed numbers ride the Dynamic Type curve.
    func kathaFrame(width: CGFloat? = nil, height: CGFloat? = nil,
                    alignment: Alignment = .center,
                    relativeTo style: Font.TextStyle = .body) -> some View {
        modifier(KathaScaledFrame(width: width, height: height,
                                  alignment: alignment, style: style))
    }
}

/// Physical feedback on the moments that matter: taps confirm, money succeeds,
/// gates warn. Coalesced here so screens never construct generators inline.
@MainActor
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}

/// Cards and posters compress slightly under the finger — the touch feel that
/// separates a native app from a web view. Honors Reduce Motion.
struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(Katha.Motion.snappy, value: configuration.isPressed)
    }
}

// MARK: - Loading shimmer

/// A soft highlight sweeping across skeleton blocks while content loads.
/// Static under Reduce Motion.
struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content.overlay {
            if !reduceMotion {
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, .white.opacity(0.07), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.7)
                        .offset(x: phase * geo.size.width * 1.7)
                }
                .allowsHitTesting(false)
                .onAppear {
                    withAnimation(.linear(duration: 1.15).repeatForever(autoreverses: false)) {
                        phase = 1
                    }
                }
            }
        }
        .clipped()
    }
}

/// One grey placeholder block of the skeleton screens.
struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat
    var radius: CGFloat = Katha.Radius.md

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Katha.Color.surface)
            .frame(width: width, height: height)
            .modifier(Shimmer())
    }
}

// MARK: - Hero → series zoom (iOS 18+, standard push everywhere else)

extension EnvironmentValues {
    /// Namespace shared between the Home hero (source) and SeriesView
    /// (destination) for the container zoom transition.
    @Entry var zoomNamespace: Namespace.ID?
}

private struct ZoomSourceModifier: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var ns

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *), let ns {
            content.matchedTransitionSource(id: id, in: ns)
        } else {
            content
        }
    }
}

private struct ZoomDestinationModifier: ViewModifier {
    let id: String
    @Environment(\.zoomNamespace) private var ns

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *), let ns {
            content.navigationTransition(.zoom(sourceID: id, in: ns))
        } else {
            content
        }
    }
}

extension View {
    func zoomSource(id: String) -> some View { modifier(ZoomSourceModifier(id: id)) }
    func zoomDestination(id: String) -> some View { modifier(ZoomDestinationModifier(id: id)) }
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
                .kathaFont(16, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background {
                    if enabled {
                        LinearGradient(colors: [Katha.Color.accent,
                                                Katha.Color.accentPressed],
                                       startPoint: .top, endPoint: .bottom)
                    } else {
                        Katha.Color.raised
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
    }
}

/// The house scrim: key art fading vertically into the page ground so titles
/// read over any cover. Every image-over-bg fade in the app goes through this,
/// so the fade retunes in one place. `stops` are (bg-opacity, location) pairs
/// top→bottom; `topTint` darkens the top of the art for status-bar legibility.
struct HeroScrim: View {
    var topTint: Double = 0
    let stops: [(opacity: Double, location: Double)]

    var body: some View {
        LinearGradient(
            stops: (topTint > 0 ? [Gradient.Stop(color: .black.opacity(topTint), location: 0)] : [])
                + stops.map { .init(color: Katha.Color.bg.opacity($0.opacity),
                                    location: $0.location) },
            startPoint: .top, endPoint: .bottom
        )
    }
}

/// Katha's signature line: a sindoor→marigold hairline. The same ribbon runs
/// under the site header and the admin topbar — one brand mark, three surfaces.
struct BrandRibbon: View {
    var body: some View {
        LinearGradient(colors: [Katha.Color.accent, Katha.Color.coin],
                       startPoint: .leading, endPoint: .trailing)
            .frame(height: 2)
            .accessibilityHidden(true)
    }
}

/// A coin count with the coin-gold pip, used across paywall and wallet.
struct CoinBadge: View {
    let coins: Int
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(Katha.Color.coin).frame(width: 14, height: 14)
            Text("\(coins)")
                .kathaFont(14, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
        }
    }
}


/// The poster wall used by Browse, My list and a person's credits: three even
/// columns on every phone. An adaptive grid sized to the 122 pt rail poster fit
/// only two on a 402 pt screen and left ~50 pt gutters between them.
enum PosterGrid {
    static let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
}

/// A horizontal scroller's content should look cut off, not broken: the last
/// chip fades into the page ground instead of being sliced mid-word.
private struct TrailingFade: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay(alignment: .trailing) {
            LinearGradient(colors: [Katha.Color.bg.opacity(0), Katha.Color.bg],
                           startPoint: .leading, endPoint: .trailing)
                .frame(width: 40)
                .allowsHitTesting(false)
        }
    }
}

extension View {
    func trailingFade() -> some View { modifier(TrailingFade()) }
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
