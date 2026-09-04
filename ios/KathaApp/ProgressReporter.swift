import Foundation
import KathaKit

/// Serializes watch-progress reports: one request in flight per player, and
/// only the LATEST position is sent when several arrive while one is out.
/// Reports were fire-and-forget Tasks before, so a 30 s report could land after
/// a 35 s one and roll the resume point back.
actor ProgressReporter {
    private let api: KathaAPIClient
    private var latest: ProgressReport?
    private var sending = false

    init(api: KathaAPIClient) { self.api = api }

    /// Queue a report; returns once the queue has drained (callers fire and
    /// forget). A report that arrives mid-send replaces any unsent one.
    func submit(_ report: ProgressReport) async {
        latest = report
        guard !sending else { return }
        sending = true
        defer { sending = false }
        while let next = latest {
            latest = nil
            try? await api.reportProgress([next])
        }
    }
}
