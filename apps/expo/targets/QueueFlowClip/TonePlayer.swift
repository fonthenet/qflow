import AVFoundation

/// Generates tones programmatically using AVAudioEngine — no audio files needed.
final class TonePlayer {
    static let shared = TonePlayer()

    private var engine: AVAudioEngine?
    private var sourceNode: AVAudioSourceNode?
    private var isPlaying = false

    // MARK: - Called Tone (ascending 880→1100→1320 Hz)

    func playCalledTone() {
        // Tone schedule: [(frequency, startSample, durationSamples)]
        let sampleRate: Double = 44100
        let tones: [(freq: Double, start: Double, dur: Double)] = [
            (880,  0.0,  0.3),   // 880Hz for 0.3s
            (1100, 0.35, 0.3),   // 1100Hz at 0.35s for 0.3s
            (1320, 0.7,  0.5),   // 1320Hz at 0.7s for 0.5s
        ]
        let totalDuration = 1.3 // seconds

        playTones(tones, sampleRate: sampleRate, totalDuration: totalDuration, waveform: .sine)
    }

    // MARK: - Buzz Tone (aggressive square wave 180/230 Hz)

    func playBuzzTone() {
        let sampleRate: Double = 44100
        let tones: [(freq: Double, start: Double, dur: Double)] = [
            (180, 0.0,  0.18),
            (230, 0.22, 0.18),
            (180, 0.44, 0.18),
            (230, 0.66, 0.18),
        ]
        let totalDuration = 0.9

        playTones(tones, sampleRate: sampleRate, totalDuration: totalDuration, waveform: .square)
    }

    // MARK: - Engine

    private enum Waveform { case sine, square }

    private func playTones(
        _ tones: [(freq: Double, start: Double, dur: Double)],
        sampleRate: Double,
        totalDuration: Double,
        waveform: Waveform
    ) {
        guard !isPlaying else { return }
        isPlaying = true

        // Configure audio session
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.mixWithOthers])
        try? session.setActive(true)

        let engine = AVAudioEngine()
        var currentSample: Int = 0
        let totalSamples = Int(totalDuration * sampleRate)

        // Build lookup: for each sample index, what frequency and amplitude?
        // Pre-compute tone ranges
        struct ToneRange {
            let freq: Double
            let startSample: Int
            let endSample: Int
        }
        let ranges: [ToneRange] = tones.map { t in
            ToneRange(
                freq: t.freq,
                startSample: Int(t.start * sampleRate),
                endSample: Int((t.start + t.dur) * sampleRate)
            )
        }

        let sourceNode = AVAudioSourceNode(format: AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1
        )!) { _, _, frameCount, bufferList -> OSStatus in
            let buffer = UnsafeMutableBufferPointer<Float>(
                start: bufferList.pointee.mBuffers.mData?.assumingMemoryBound(to: Float.self),
                count: Int(frameCount)
            )

            for frame in 0..<Int(frameCount) {
                let sampleIndex = currentSample + frame
                var sample: Float = 0.0

                if sampleIndex < totalSamples {
                    for range in ranges {
                        if sampleIndex >= range.startSample && sampleIndex < range.endSample {
                            let t = Double(sampleIndex) / sampleRate
                            let phase = 2.0 * .pi * range.freq * t

                            // Fade envelope: quick attack, exponential decay
                            let elapsed = Double(sampleIndex - range.startSample) / sampleRate
                            let duration = Double(range.endSample - range.startSample) / sampleRate
                            let envelope = Float(max(0.01, 1.0 - (elapsed / duration) * 0.7))

                            switch waveform {
                            case .sine:
                                sample = Float(sin(phase)) * envelope * 0.4
                            case .square:
                                sample = (sin(phase) > 0 ? 1.0 : -1.0) * envelope * 0.3
                            }
                            break
                        }
                    }
                }

                buffer[frame] = sample
            }

            currentSample += Int(frameCount)
            return noErr
        }

        engine.attach(sourceNode)
        engine.connect(sourceNode, to: engine.mainMixerNode, format: AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1
        ))

        do {
            try engine.start()
        } catch {
            isPlaying = false
            return
        }

        self.engine = engine
        self.sourceNode = sourceNode

        // Stop after total duration
        DispatchQueue.main.asyncAfter(deadline: .now() + totalDuration + 0.1) { [weak self] in
            self?.stop()
        }
    }

    private func stop() {
        engine?.stop()
        if let node = sourceNode {
            engine?.detach(node)
        }
        engine = nil
        sourceNode = nil
        isPlaying = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
