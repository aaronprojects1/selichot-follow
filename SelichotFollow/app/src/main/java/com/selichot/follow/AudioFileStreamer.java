package com.selichot.follow;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Decodes the audio track from an audio or video Uri into a SpeechRecognizer PCM pipe. */
final class AudioFileStreamer {
    interface Callback {
        void onProgress(long positionUs, long durationUs);
        void onComplete();
        void onError(Exception error);
    }

    static final class Probe {
        final int sampleRate;
        final int channelCount;
        final long durationUs;
        final String mime;

        Probe(int sampleRate, int channelCount, long durationUs, String mime) {
            this.sampleRate = sampleRate;
            this.channelCount = channelCount;
            this.durationUs = durationUs;
            this.mime = mime;
        }
    }

    private final Context context;
    private final Uri uri;
    private final ParcelFileDescriptor outputDescriptor;
    private final Callback callback;
    private volatile boolean cancelled;
    private Thread worker;

    AudioFileStreamer(Context context, Uri uri, ParcelFileDescriptor outputDescriptor, Callback callback) {
        this.context = context.getApplicationContext();
        this.uri = uri;
        this.outputDescriptor = outputDescriptor;
        this.callback = callback;
    }

    static Probe probe(Context context, Uri uri) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(context, uri, null);
            int track = findAudioTrack(extractor);
            if (track < 0) throw new IllegalArgumentException("No audio track was found in this file.");
            MediaFormat format = extractor.getTrackFormat(track);
            String mime = format.getString(MediaFormat.KEY_MIME);
            int rate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 16000;
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            long duration = format.containsKey(MediaFormat.KEY_DURATION) ? format.getLong(MediaFormat.KEY_DURATION) : 0;
            return new Probe(rate, channels, duration, mime == null ? "audio/unknown" : mime);
        } finally {
            extractor.release();
        }
    }

    void start() {
        worker = new Thread(this::decode, "selichot-audio-decoder");
        worker.start();
    }

    void cancel() {
        cancelled = true;
        closeQuietly(outputDescriptor);
        if (worker != null) worker.interrupt();
    }

    private void decode() {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        FileOutputStream output = null;
        try {
            extractor.setDataSource(context, uri, null);
            int track = findAudioTrack(extractor);
            if (track < 0) throw new IllegalArgumentException("No audio track was found in this file.");
            extractor.selectTrack(track);
            MediaFormat inputFormat = extractor.getTrackFormat(track);
            String mime = inputFormat.getString(MediaFormat.KEY_MIME);
            if (mime == null) throw new IllegalArgumentException("The audio codec could not be identified.");
            inputFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            long durationUs = inputFormat.containsKey(MediaFormat.KEY_DURATION)
                    ? inputFormat.getLong(MediaFormat.KEY_DURATION) : 0;

            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(inputFormat, null, null, 0);
            codec.start();
            output = new FileOutputStream(outputDescriptor.getFileDescriptor());

            boolean inputEnded = false;
            boolean outputEnded = false;
            int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!outputEnded && !cancelled) {
                if (!inputEnded) {
                    int inputIndex = codec.dequeueInputBuffer(10_000);
                    if (inputIndex >= 0) {
                        ByteBuffer input = codec.getInputBuffer(inputIndex);
                        if (input == null) continue;
                        input.clear();
                        int size = extractor.readSampleData(input, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            long timeUs = extractor.getSampleTime();
                            codec.queueInputBuffer(inputIndex, 0, size, Math.max(0, timeUs), 0);
                            extractor.advance();
                        }
                    }
                }

                int outputIndex = codec.dequeueOutputBuffer(info, 10_000);
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat decoded = codec.getOutputFormat();
                    if (decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        pcmEncoding = decoded.getInteger(MediaFormat.KEY_PCM_ENCODING);
                    }
                } else if (outputIndex >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(outputIndex);
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset);
                        buffer.limit(info.offset + info.size);
                        if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
                            output.write(floatToPcm16(buffer));
                        } else if (pcmEncoding == AudioFormat.ENCODING_PCM_16BIT) {
                            byte[] bytes = new byte[info.size];
                            buffer.get(bytes);
                            output.write(bytes);
                        } else {
                            throw new IllegalArgumentException("Unsupported decoded PCM encoding: " + pcmEncoding);
                        }
                        callback.onProgress(info.presentationTimeUs, durationUs);
                    }
                    outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    codec.releaseOutputBuffer(outputIndex, false);
                }
            }
            if (!cancelled) callback.onComplete();
        } catch (Exception error) {
            if (!cancelled) callback.onError(error);
        } finally {
            if (codec != null) {
                try { codec.stop(); } catch (Exception ignored) {}
                codec.release();
            }
            extractor.release();
            if (output != null) {
                try { output.close(); } catch (Exception ignored) {}
            }
            closeQuietly(outputDescriptor);
        }
    }

    private static int findAudioTrack(MediaExtractor extractor) {
        for (int i = 0; i < extractor.getTrackCount(); i++) {
            String mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith("audio/")) return i;
        }
        return -1;
    }

    private static byte[] floatToPcm16(ByteBuffer input) {
        ByteBuffer source = input.slice().order(ByteOrder.nativeOrder());
        int samples = source.remaining() / 4;
        ByteBuffer target = ByteBuffer.allocate(samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < samples; i++) {
            float value = Math.max(-1f, Math.min(1f, source.getFloat()));
            target.putShort((short) Math.round(value * 32767f));
        }
        return target.array();
    }

    private static void closeQuietly(ParcelFileDescriptor descriptor) {
        try { descriptor.close(); } catch (Exception ignored) {}
    }
}
