// Synthetic portrait HEVC fixture, deliberately without audio. PNG does not
// require AAC. AVAssetWriter specifies actual dimensions instead of an upscale preset.
import Foundation
import AVFoundation
import CoreVideo

let width = 2160, height = 3842
let url = URL(fileURLWithPath: CommandLine.arguments[1])
if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.hevc,
    AVVideoWidthKey: width, AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 500_000, AVVideoExpectedSourceFrameRateKey: 2]
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height
])
writer.add(input)
guard writer.startWriting() else { fatalError("HEVC writer unavailable") }
writer.startSession(atSourceTime: .zero)
for frame in 0..<6 {
    let deadline = Date().addingTimeInterval(15)
    while !input.isReadyForMoreMediaData && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    guard input.isReadyForMoreMediaData else { fatalError("HEVC writer timeout") }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nil, &buffer) == kCVReturnSuccess, let buffer else { fatalError("Pixel buffer unavailable") }
    CVPixelBufferLockBaseAddress(buffer, [])
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let ptr = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
    for y in 0..<height {
        for x in 0..<width {
            let i = y * stride + x * 4
            ptr[i] = 180; ptr[i+1] = UInt8(y * 255 / height); ptr[i+2] = UInt8(30 + frame * 30); ptr[i+3] = 255
        }
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 2)) else { fatalError("HEVC append failed") }
}
writer.endSession(atSourceTime: CMTime(value: 3, timescale: 1))
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
guard done.wait(timeout: .now() + 30) == .success, writer.status == .completed else { fatalError("HEVC fixture encoding failed") }
print("Generated synthetic 2160×3842 HEVC video without audio")
