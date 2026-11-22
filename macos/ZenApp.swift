// zen.app: the companion for https://zen.dio.la as a small menu bar app (the .dmg install).
// It runs the bundled companion while it's open; the web page does everything else.

import AppKit
import ServiceManagement

let siteURL = URL(string: "https://zen.dio.la")!
let port = Int(ProcessInfo.processInfo.environment["ZEN_PORT"] ?? "") ?? 47470

final class App: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private var companion: Process?
    private var quitting = false
    private var sigterm: DispatchSourceSignal?
    private let status = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")

    func applicationDidFinishLaunching(_ note: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = Self.icon()
        item.button?.toolTip = "zen"

        let menu = NSMenu()
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Open zen", action: #selector(openSite), keyEquivalent: "o"))
        login.target = self
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit zen", action: #selector(quit), keyEquivalent: "q"))
        for m in menu.items where m.action != nil && m.target == nil { m.target = self }
        item.menu = menu
        refreshLogin()

        // A polite kill (logout, `kill`) still takes the companion along.
        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        term.setEventHandler { [weak self] in self?.quit() }
        term.resume()
        signal(SIGTERM, SIG_IGN)
        sigterm = term

        start()
        // First launch ever: say hello by opening the room.
        if !UserDefaults.standard.bool(forKey: "opened") {
            UserDefaults.standard.set(true, forKey: "opened")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.openSite() }
        }
    }

    /// A small open circle, drawn so it follows the menu bar's light/dark appearance.
    static func icon() -> NSImage {
        let img = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            let path = NSBezierPath()
            path.appendArc(withCenter: NSPoint(x: rect.midX, y: rect.midY), radius: 6.2,
                           startAngle: 100, endAngle: 100 + 335)
            path.lineWidth = 1.8
            path.lineCapStyle = .round
            NSColor.black.setStroke()
            path.stroke()
            return true
        }
        img.isTemplate = true
        return img
    }

    private func start() {
        if Self.portInUse() {
            // Another companion (e.g. the Homebrew service) is already serving the room.
            status.title = "Running (another companion)"
            return
        }
        let res = Bundle.main.resourceURL!
        let p = Process()
        p.executableURL = res.appendingPathComponent("zen-companion")
        var env = ProcessInfo.processInfo.environment
        let home = NSHomeDirectory()
        env["ZEN_WEB_DIR"] = res.appendingPathComponent("web").path
        env["ZEN_SPEECH_DIR"] = res.appendingPathComponent("speech").path
        env["ZEN_UV"] = res.appendingPathComponent("uv").path
        env["ZEN_INSTALL"] = "app"
        // Apps launch with a minimal PATH; Claude Code usually lives in one of these.
        env["PATH"] = ["\(home)/.local/bin", "\(home)/.claude/local", "/opt/homebrew/bin", "/usr/local/bin",
                       env["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")
        p.environment = env
        let logs = URL(fileURLWithPath: "\(home)/Library/Logs/zen", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let log = logs.appendingPathComponent("companion.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: log) {
            h.seekToEndOfFile()
            p.standardOutput = h
            p.standardError = h
        }
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.status.title = "Restarting…"
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.start() }
            }
        }
        do {
            try p.run()
            companion = p
            status.title = "Running"
        } catch {
            status.title = "Could not start"
        }
    }

    static func portInUse() -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    @objc func openSite() { NSWorkspace.shared.open(siteURL) }

    private func refreshLogin() {
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            NSAlert(error: error).runModal()
        }
        refreshLogin()
    }

    @objc func quit() {
        quitting = true
        companion?.terminate()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ note: Notification) {
        quitting = true
        companion?.terminate()
        companion?.waitUntilExit()
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
