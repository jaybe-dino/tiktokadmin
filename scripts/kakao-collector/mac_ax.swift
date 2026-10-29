// KakaoTalk evidence capture and narrowly scoped export-menu navigation. No sending.
import Cocoa
import ApplicationServices

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
var remaining = 12000
func find(_ element: AXUIElement, role: String, title: String, depth: Int = 0) -> [AXUIElement] {
    if depth > 12 { return [] }
    var matches: [AXUIElement] = []
    if attribute(element, kAXRoleAttribute) as? String == role &&
       attribute(element, kAXTitleAttribute) as? String == title { matches.append(element) }
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        matches += find(child, role: role, title: title, depth: depth + 1)
    }
    return matches
}
func tree(_ element: AXUIElement, _ depth: Int = 0) -> [String: Any] {
    remaining -= 1
    var result: [String: Any] = [:]
    for key in [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute,
                kAXDescriptionAttribute, kAXValueAttribute, kAXIdentifierAttribute, kAXHelpAttribute] {
        if let value = attribute(element, key) as? String { result[key] = value }
    }
    var actions: CFArray?
    if AXUIElementCopyActionNames(element, &actions) == .success { result["actions"] = actions as? [String] ?? [] }
    if let p = attribute(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID() {
        var point = CGPoint.zero
        if AXValueGetValue(p as! AXValue, .cgPoint, &point) { result["position"] = [point.x, point.y] }
    }
    if depth < 16 && remaining > 0,
       let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        result["children"] = children.prefix(5000).map { tree($0, depth + 1) }
    }
    return result
}
let args = CommandLine.arguments
guard args.count >= 4, ["snapshot", "menus", "export-menu", "settings", "storage", "save-text", "confirm-save", "finish-export"].contains(args[1]) else {
    fputs("Usage: mac_ax snapshot <exact-room-title> <output.json> OR menus - <output.json>\n", stderr)
    exit(2)
}
guard AXIsProcessTrusted() else { fputs("accessibility_not_authorized\n", stderr); exit(3) }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.kakao.KakaoTalkMac").first else {
    fputs("kakao_not_running\n", stderr); exit(4)
}
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root, 3)
var target: AXUIElement?
if args[1] == "menus" {
    target = attribute(root, kAXMenuBarAttribute) as! AXUIElement?
} else if let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] {
    let matches = windows.filter { attribute($0, kAXTitleAttribute) as? String == args[2] }
    if matches.count == 1 { target = matches[0] }
}
guard let selected = target else { fputs("target_not_unique_or_absent\n", stderr); exit(5) }
if args[1] == "export-menu" {
    let children = attribute(selected, kAXChildrenAttribute) as? [AXUIElement] ?? []
    let menus = children.filter { attribute($0, kAXRoleAttribute) as? String == kAXButtonRole &&
        attribute($0, kAXDescriptionAttribute) as? String == "메뉴" }
    guard menus.count == 1 else { fputs("export_menu_not_unique\n", stderr); exit(6) }
    app.activate(options: [])
    AXUIElementPerformAction(selected, kAXRaiseAction as CFString)
    for _ in 0..<20 {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
           let focused = attribute(root, kAXFocusedWindowAttribute),
           attribute(focused as! AXUIElement, kAXTitleAttribute) as? String == args[2] { break }
    }
    // Kakao's custom buttons expose no AXPress action. Use only this identified
    // export-menu button's live geometry, with strict focus checks.
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
          let focused = attribute(root, kAXFocusedWindowAttribute),
          attribute(focused as! AXUIElement, kAXTitleAttribute) as? String == args[2],
          let position = attribute(menus[0], kAXPositionAttribute),
          let size = attribute(menus[0], kAXSizeAttribute) else {
        print("foreground=\(NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "none")")
        if let focused = attribute(root, kAXFocusedWindowAttribute) {
            print("focused_window=\(attribute(focused as! AXUIElement, kAXTitleAttribute) as? String ?? "none")")
        }
        fputs("focus_or_geometry_not_verified\n", stderr); exit(7)
    }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { exit(7) }
    point.x += dimensions.width / 2
    point.y += dimensions.height / 2
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
}
if args[1] == "settings" {
    let roots = (attribute(root, kAXChildrenAttribute) as? [AXUIElement] ?? []).filter {
        attribute($0, kAXRoleAttribute) as? String == kAXMenuRole
    }
    var matches = find(selected, role: kAXMenuItemRole, title: "채팅방 설정")
    if matches.isEmpty { matches = roots.flatMap { find($0, role: kAXMenuItemRole, title: "채팅방 설정") } }
    guard matches.count == 1 else { fputs("settings_menu_not_unique\n", stderr); exit(8) }
    guard AXUIElementPerformAction(matches[0], kAXPressAction as CFString) == .success else { exit(9) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
}
if args[1] == "storage" {
    let children = attribute(selected, kAXChildrenAttribute) as? [AXUIElement] ?? []
    guard children.contains(where: { attribute($0, kAXValueAttribute) as? String == "채팅방 설정" }) else { exit(10) }
    let tabs = children.filter { attribute($0, kAXIdentifierAttribute) as? String == "_NS:50" &&
        attribute($0, kAXRoleAttribute) as? String == kAXButtonRole }
    guard tabs.count == 1 else { exit(12) }
    guard AXUIElementPerformAction(tabs[0], kAXPressAction as CFString) == .success else { exit(13) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
}
if args[1] == "save-text" {
    let matches = find(selected, role: kAXButtonRole, title: "텍스트 파일로 저장")
    guard matches.count == 1 else { exit(14) }
    guard AXUIElementPerformAction(matches[0], kAXPressAction as CFString) == .success else { exit(15) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
}
if args[1] == "confirm-save" {
    let sheets = (attribute(selected, kAXChildrenAttribute) as? [AXUIElement] ?? []).filter {
        attribute($0, kAXRoleAttribute) as? String == kAXSheetRole
    }
    guard sheets.count == 1,
          attribute(sheets[0], kAXIdentifierAttribute) as? String == "save-panel" else { exit(16) }
    let children = attribute(sheets[0], kAXChildrenAttribute) as? [AXUIElement] ?? []
    let fields = children.filter { attribute($0, kAXIdentifierAttribute) as? String == "saveAsNameTextField" }
    guard fields.count == 1,
          let name = attribute(fields[0], kAXValueAttribute) as? String,
          args.count == 5, name.hasPrefix("KakaoTalk_Chat_" + args[4] + "_") else { exit(17) }
    let save = find(sheets[0], role: kAXButtonRole, title: "저장")
    guard save.count == 1 else { exit(18) }
    guard AXUIElementPerformAction(save[0], kAXPressAction as CFString) == .success else { exit(19) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
}
if args[1] == "finish-export" {
    let children = attribute(selected, kAXChildrenAttribute) as? [AXUIElement] ?? []
    let sheets = children.filter { attribute($0, kAXRoleAttribute) as? String == kAXSheetRole }
    guard sheets.count == 1 else { exit(20) }
    let inner = attribute(sheets[0], kAXChildrenAttribute) as? [AXUIElement] ?? []
    guard inner.contains(where: { attribute($0, kAXValueAttribute) as? String == "대화내용 내보내기가 완료되었습니다." }) else { exit(21) }
    let done = find(sheets[0], role: kAXButtonRole, title: "확인")
    guard done.count == 1, AXUIElementPerformAction(done[0], kAXPressAction as CFString) == .success else { exit(22) }
    let close = children.filter { attribute($0, kAXSubroleAttribute) as? String == kAXCloseButtonSubrole }
    if close.count == 1 { AXUIElementPerformAction(close[0], kAXPressAction as CFString) }
}
var output = tree(selected)
let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
output["windowTitles"] = windows.map { attribute($0, kAXTitleAttribute) as? String ?? "" }
output["settingsWindows"] = windows.filter { (attribute($0, kAXTitleAttribute) as? String ?? "").contains("설정") }.map { tree($0) }
if args[1] == "export-menu" {
    let children = attribute(root, kAXChildrenAttribute) as? [AXUIElement] ?? []
    output["applicationMenus"] = children.filter {
        attribute($0, kAXRoleAttribute) as? String == kAXMenuRole
    }.map { tree($0) }
    if let focused = attribute(root, kAXFocusedUIElementAttribute) {
        output["focusedElement"] = tree(focused as! AXUIElement)
    }
}
let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
let url = URL(fileURLWithPath: args[3])
try data.write(to: url, options: .atomic)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
print("snapshot_saved bytes=\(data.count)")
