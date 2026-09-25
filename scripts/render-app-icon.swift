// Renders the icon macOS itself draws for an .app bundle, to a PNG.
//
// Used by scripts/generate-icons.sh to produce build/dock-dev.png. macOS 26
// composes an app icon from the layers in Assets.car at display time — it
// applies the superellipse mask, the icon-grid inset, per-layer specular
// lighting and the drop shadow. None of that is baked into the source artwork,
// and none of it is reproducible with an image editor: the only way to obtain
// the exact pixels the Dock shows is to ask AppKit for them, which is what this
// does. Run via `swift render-app-icon.swift <app-path> <out.png>` — no compile
// step, and no build product to keep in sync.
import AppKit

let args = CommandLine.arguments
guard args.count == 3 || args.count == 4 else {
    FileHandle.standardError.write(
        Data("usage: render-app-icon.swift <app-path> <out.png> [expected-rrggbb]\n".utf8))
    exit(64) // EX_USAGE
}
let (appPath, outPath) = (args[1], args[2])

/// The icon's dominant colour, when the caller knows it. See the verification
/// below for why this is worth passing.
let expected: (r: Int, g: Int, b: Int)? = args.count == 4 ? {
    let hex = args[3].hasPrefix("#") ? String(args[3].dropFirst()) : args[3]
    guard hex.count >= 6, let value = Int(hex.prefix(6), radix: 16) else {
        FileHandle.standardError.write(Data("not a RRGGBB colour: \(args[3])\n".utf8))
        exit(64)
    }
    return ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)
}() : nil

guard FileManager.default.fileExists(atPath: appPath) else {
    FileHandle.standardError.write(Data("no such bundle: \(appPath)\n".utf8))
    exit(66) // EX_NOINPUT
}

// 1024² is the largest slot any macOS icon artefact carries, so rendering at
// that size resamples nothing — the Dock scales down from here as it does for
// every other app.
let side = 1024
let icon = NSWorkspace.shared.icon(forFile: appPath)

guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else {
    FileHandle.standardError.write(Data("could not allocate a \(side)² bitmap\n".utf8))
    exit(70) // EX_SOFTWARE
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: side, height: side),
          from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()

// Verify we actually got the app's icon.
//
// This is not belt-and-braces: when Launch Services has not (re)registered the
// bundle — which is exactly what happens to a path that has just been
// overwritten by a rebuild — `icon(forFile:)` returns the generic white
// document placeholder and reports no error at all. A caller that trusts the
// exit code then ships a picture of a blank sheet of paper. The placeholder is
// fully opaque, so an alpha-only check does not catch it; the reliable
// discriminator is the artwork's own colour.
//
// Read the bytes straight out of the bitmap: one NSColor per pixel would cost
// more than the render itself.
guard let pixels = rep.bitmapData else {
    FileHandle.standardError.write(Data("bitmap has no backing store\n".utf8))
    exit(70)
}

let total = side * side
var opaque = 0
var onBrand = 0
let tolerance = 40 // per channel; the composed icon shades the fill with specular lighting

for y in 0..<side {
    let row = pixels + y * rep.bytesPerRow
    for x in 0..<side {
        let px = row + x * 4
        guard px[3] != 0 else { continue }
        opaque += 1
        if let want = expected,
           abs(Int(px[0]) - want.r) <= tolerance,
           abs(Int(px[1]) - want.g) <= tolerance,
           abs(Int(px[2]) - want.b) <= tolerance {
            onBrand += 1
        }
    }
}

guard opaque > 0 else {
    FileHandle.standardError.write(Data("rendered icon is empty for \(appPath)\n".utf8))
    exit(70)
}

// A macOS icon is inset in its canvas, so its own colour covers well over half
// the opaque area — the real render measures ~59%. The generic placeholder
// measures 0. Anything under a fifth means we did not get the icon we asked for.
if let want = expected {
    let share = Double(onBrand) / Double(total)
    guard share >= 0.20 else {
        let hex = String(format: "%02X%02X%02X", want.r, want.g, want.b)
        FileHandle.standardError.write(Data("""
            \(appPath) did not render as its own icon: only \
            \(String(format: "%.1f", share * 100))% of the image is near #\(hex).
            Launch Services is probably serving a placeholder — re-register the \
            bundle with lsregister -f before rendering.

            """.utf8))
        exit(70)
    }
}

guard let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("PNG encoding failed\n".utf8))
    exit(70)
}
try png.write(to: URL(fileURLWithPath: outPath))
