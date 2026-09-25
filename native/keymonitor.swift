// ClawMuse key monitor — Muse's modifier-key gestures, which Electron's
// globalShortcut cannot express:
//   • push-to-talk: hold fn / Option / Control → record 16 kHz mono WAV;
//     release → "ptt-stop <path>" (the app transcribes it and sends "type …")
//   • "Tap Option twice" → "double-option" (opens Quick Chat)
// argv: <ptt: off|fn|option|control> [--double-option]
// stdout (one event per line): trusted | untrusted | ptt-start | ptt-stop <path> | ptt-cancel | double-option | typed | error <msg>
// stdin: "type <base64 utf-8>" pastes text into the frontmost app; EOF quits.
import AppKit
import AVFoundation
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)
func emit(_ line: String) { print(line); fflush(stdout) }

let args = CommandLine.arguments
let pttKey = args.count > 1 ? args[1] : "off"
let doubleOption = args.contains("--double-option")

// Global key monitors only deliver events once the app is trusted for Accessibility.
emit(AXIsProcessTrusted() ? "trusted" : "untrusted")

var recorder: AVAudioRecorder?
var recordingURL: URL?

func startRecording() {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("clawmuse-ptt-\(UUID().uuidString).wav")
  let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
  ]
  do {
    let next = try AVAudioRecorder(url: url, settings: settings)
    guard next.record() else { emit("error microphone unavailable"); return }
    recorder = next
    recordingURL = url
    emit("ptt-start")
  } catch {
    emit("error \(error.localizedDescription)")
  }
}

func stopRecording() {
  guard let active = recorder, let url = recordingURL else { return }
  let seconds = active.currentTime
  active.stop()
  recorder = nil
  recordingURL = nil
  // A brushed key is not an utterance.
  if seconds < 0.3 {
    try? FileManager.default.removeItem(at: url)
    emit("ptt-cancel")
    return
  }
  emit("ptt-stop \(url.path)")
}

func isHeld(_ flags: NSEvent.ModifierFlags) -> Bool {
  switch pttKey {
  case "fn": return flags.contains(.function)
  case "option": return flags.contains(.option)
  case "control": return flags.contains(.control)
  default: return false
  }
}

var pttHeld = false
var optionDown = false
var optionDownAt: TimeInterval = 0
var lastTapAt: TimeInterval = 0
var tapSpoiled = false

func handle(_ event: NSEvent) {
  if event.type == .keyDown {
    tapSpoiled = true
    lastTapAt = 0
    return
  }
  let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad])
  if pttKey != "off" {
    let held = isHeld(flags)
    if held && !pttHeld { pttHeld = true; startRecording() }
    else if !held && pttHeld { pttHeld = false; stopRecording() }
  }
  guard doubleOption else { return }
  let now = ProcessInfo.processInfo.systemUptime
  if flags == [.option] && !optionDown {
    optionDown = true
    optionDownAt = now
    tapSpoiled = false
  } else if optionDown && !flags.contains(.option) {
    optionDown = false
    // A tap is a quick, clean Option press; two within 450 ms is the gesture.
    if !tapSpoiled && now - optionDownAt < 0.3 {
      if lastTapAt > 0 && now - lastTapAt < 0.45 { lastTapAt = 0; emit("double-option") } else { lastTapAt = now }
    } else {
      lastTapAt = 0
    }
  } else if optionDown && flags != [.option] {
    tapSpoiled = true
  }
}

func typeText(_ text: String) {
  let board = NSPasteboard.general
  let saved: [[NSPasteboard.PasteboardType: Data]] = (board.pasteboardItems ?? []).map { item in
    var copy: [NSPasteboard.PasteboardType: Data] = [:]
    for type in item.types { if let data = item.data(forType: type) { copy[type] = data } }
    return copy
  }
  board.clearContents()
  board.setString(text, forType: .string)
  // ponytail: ⌘V by virtual key 9 ('v' on ANSI/ISO layouts); layouts that move
  // V would need the key resolved through TISCopyCurrentKeyboardLayoutInputSource.
  let source = CGEventSource(stateID: .combinedSessionState)
  for down in [true, false] {
    let key = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: down)
    key?.flags = .maskCommand
    key?.post(tap: .cghidEventTap)
  }
  // Give the target app time to read the pasteboard, then put the user's clipboard back.
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
    board.clearContents()
    let items: [NSPasteboardItem] = saved.map { copy in
      let item = NSPasteboardItem()
      for (type, data) in copy { item.setData(data, forType: type) }
      return item
    }
    if !items.isEmpty { board.writeObjects(items) }
    emit("typed")
  }
}

NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown], handler: handle)

DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine() {
    if line.hasPrefix("type "), let data = Data(base64Encoded: String(line.dropFirst(5))), let text = String(data: data, encoding: .utf8) {
      DispatchQueue.main.async { typeText(text) }
    }
  }
  // The app closed our stdin: it quit or restarted us.
  DispatchQueue.main.async { recorder?.stop(); exit(0) }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
app.run()
