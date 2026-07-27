import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2,
      let processId = Int32(CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data("usage: verify-visible-window.swift <pid>\n".utf8))
    exit(2)
}

let windows = CGWindowListCopyWindowInfo(
    [.optionAll, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] ?? []

let hasVisibleWindow = windows.contains { window in
    let ownerPid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
    let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue
    let alpha = (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue
    guard ownerPid == processId, layer == 0, (alpha ?? 0) > 0,
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let width = (bounds["Width"] as? NSNumber)?.doubleValue,
          let height = (bounds["Height"] as? NSNumber)?.doubleValue else {
        return false
    }
    return width >= 320 && height >= 240
}

exit(hasVisibleWindow ? 0 : 1)
