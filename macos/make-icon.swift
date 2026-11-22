// Draws the app icon (an open ensō on a dark tile) at 1024 px: swift macos/make-icon.swift out.png
import AppKit

let size = 1024.0
let img = NSImage(size: NSSize(width: size, height: size), flipped: false) { _ in
    // macOS tile: 824 px rounded square centred in 1024, as Apple's icon grid has it.
    let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
    let shape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
    NSGradient(starting: NSColor(calibratedRed: 0.09, green: 0.085, blue: 0.08, alpha: 1),
               ending: NSColor(calibratedRed: 0.02, green: 0.02, blue: 0.025, alpha: 1))!.draw(in: shape, angle: -90)
    // The ensō: a brush stroke left open, thicker where it starts.
    let c = NSPoint(x: 512, y: 512)
    let ink = NSColor(calibratedRed: 0.93, green: 0.9, blue: 0.84, alpha: 1)
    let steps = 240
    for i in 0..<steps {
        let t = Double(i) / Double(steps)
        let a0 = (115.0 + t * 320.0) * .pi / 180, a1 = (115.0 + (t + 1.0 / Double(steps)) * 320.0) * .pi / 180
        let r = 255.0 + 6 * sin(t * 9)
        let w = 58.0 * (1 - 0.75 * t) + 8
        let p = NSBezierPath()
        p.move(to: NSPoint(x: c.x + r * cos(a0), y: c.y + r * sin(a0)))
        p.line(to: NSPoint(x: c.x + r * cos(a1), y: c.y + r * sin(a1)))
        p.lineWidth = w
        p.lineCapStyle = .round
        ink.withAlphaComponent(0.92 - 0.25 * t).setStroke()
        p.stroke()
    }
    return true
}
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
