package com.selichot.follow;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

public class MainActivity extends Activity implements RecognitionListener {
    private static final int MIC_PERMISSION = 1001;
    private static final int PICK_MEDIA = 1002;
    private static final String PREFS = "selichot_follow_v2";
    private static final String KEY_PRAYERS = "prayer_lines_json";
    private static final String KEY_INDEX = "current_index";
    private static final String KEY_DISPLAY = "display_mode";
    private static final String KEY_PROFILE = "room_profile";

    private static final int NAVY = Color.rgb(7, 17, 31);
    private static final int PANEL = Color.rgb(16, 29, 50);
    private static final int PANEL_LIGHT = Color.rgb(23, 41, 70);
    private static final int GOLD = Color.rgb(233, 190, 100);
    private static final int CREAM = Color.rgb(250, 246, 235);
    private static final int MUTED = Color.rgb(147, 163, 184);
    private static final int GREEN = Color.rgb(77, 217, 153);
    private static final int RED = Color.rgb(249, 112, 102);

    private enum DisplayMode { BOTH, HEBREW, ENGLISH }
    private enum SessionMode { IDLE, LIVE, FILE }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<PrayerLine> lines = new ArrayList<>();
    private final List<LineCard> lineCards = new ArrayList<>();
    private final TrackingEngine tracker = new TrackingEngine();
    private final ChantAcousticTracker chantAcoustics = new ChantAcousticTracker();
    private final Runnable restartRecognizer = this::safeStartLiveRecognizer;
    private final ExecutorService matcherExecutor = Executors.newSingleThreadExecutor();
    private final AtomicLong newestRecognitionJob = new AtomicLong();

    private SharedPreferences prefs;
    private SpeechRecognizer recognizer;
    private volatile SessionMode sessionMode = SessionMode.IDLE;
    private DisplayMode displayMode = DisplayMode.BOTH;
    private TrackingEngine.RoomProfile roomProfile = TrackingEngine.RoomProfile.REVERBERANT;
    private int currentIndex;
    private boolean usingStarterText;

    private LinearLayout linesContainer;
    private ScrollView scrollView;
    private TextView statusView;
    private TextView statusDot;
    private TextView heardView;
    private TextView progressView;
    private TextView displayButton;
    private TextView profileButton;
    private TextView listenButton;
    private LevelMeter levelMeter;
    private ProgressBar fileProgress;

    private AudioFileStreamer fileStreamer;
    private ParcelFileDescriptor recognitionAudioDescriptor;
    private float noiseFloor = 0.18f;
    private float peakLevel = 0.48f;
    private long listeningStartedAt;
    private int consecutiveClientErrors;
    private long lastAppliedRecognitionJob;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        restorePreferences();
        buildUi();
        loadPrayers();
        setupSpeechRecognizer();
        if (usingStarterText) handler.postDelayed(() -> downloadFromSefaria(false), 600);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(NAVY);
        window.setNavigationBarColor(NAVY);
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void restorePreferences() {
        currentIndex = prefs.getInt(KEY_INDEX, 0);
        try { displayMode = DisplayMode.valueOf(prefs.getString(KEY_DISPLAY, DisplayMode.BOTH.name())); }
        catch (Exception ignored) { displayMode = DisplayMode.BOTH; }
        try { roomProfile = TrackingEngine.RoomProfile.valueOf(
                prefs.getString(KEY_PROFILE, TrackingEngine.RoomProfile.REVERBERANT.name())); }
        catch (Exception ignored) { roomProfile = TrackingEngine.RoomProfile.REVERBERANT; }
        tracker.setRoomProfile(roomProfile);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(8), dp(16), dp(12));
        root.setBackground(gradient(NAVY, Color.rgb(13, 25, 48), GradientDrawable.Orientation.TL_BR, 0));

        root.addView(buildTopBar(), new LinearLayout.LayoutParams(-1, dp(64)));
        root.addView(buildListeningPanel(), withBottomMargin(new LinearLayout.LayoutParams(-1, -2), 12));
        root.addView(buildProgressRow(), withBottomMargin(new LinearLayout.LayoutParams(-1, -2), 8));

        scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setClipToPadding(false);
        scrollView.setPadding(0, 0, 0, dp(18));
        scrollView.setVerticalScrollBarEnabled(false);
        linesContainer = new LinearLayout(this);
        linesContainer.setOrientation(LinearLayout.VERTICAL);
        linesContainer.setPadding(0, dp(2), 0, dp(24));
        scrollView.addView(linesContainer, new ScrollView.LayoutParams(-1, -2));
        root.addView(scrollView, new LinearLayout.LayoutParams(-1, 0, 1));

        root.addView(buildBottomControls(), new LinearLayout.LayoutParams(-1, -2));
        setContentView(root);
    }

    private View buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        TextView mark = text("ס", 27, GOLD, Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        mark.setTypeface(Typeface.create("serif", Typeface.BOLD));
        mark.setBackground(shape(Color.rgb(24, 42, 69), 18, GOLD, 1));
        bar.addView(mark, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(12), 0, 0, 0);
        TextView title = text("SELICHOT  סליחות", 19, CREAM, Typeface.BOLD);
        title.setLetterSpacing(0.035f);
        TextView subtitle = text("FOLLOW THE SERVICE · עקבו בתפילה", 10, GOLD, Typeface.BOLD);
        subtitle.setLetterSpacing(0.09f);
        titles.addView(title);
        titles.addView(subtitle);
        bar.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));

        TextView menu = text("•••", 20, CREAM, Typeface.BOLD);
        menu.setGravity(Gravity.CENTER);
        menu.setContentDescription("Settings");
        menu.setBackground(shape(Color.rgb(20, 35, 58), 20, Color.TRANSPARENT, 0));
        menu.setOnClickListener(v -> showSettingsDialog());
        bar.addView(menu, new LinearLayout.LayoutParams(dp(46), dp(42)));
        return bar;
    }

    private View buildListeningPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(15), dp(13), dp(15), dp(12));
        panel.setBackground(shape(PANEL, 20, Color.rgb(39, 58, 86), 1));

        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER_VERTICAL);
        statusDot = text("●", 15, GOLD, Typeface.NORMAL);
        statusRow.addView(statusDot, new LinearLayout.LayoutParams(dp(24), -2));
        statusView = text("Ready to listen · מוכן להאזנה", 14, CREAM, Typeface.BOLD);
        statusRow.addView(statusView, new LinearLayout.LayoutParams(0, -2, 1));
        panel.addView(statusRow);

        heardView = text("Hebrew speech will appear here · הדיבור יופיע כאן", 12, MUTED, Typeface.NORMAL);
        heardView.setSingleLine(true);
        heardView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        heardView.setPadding(dp(24), dp(3), 0, dp(8));
        panel.addView(heardView, new LinearLayout.LayoutParams(-1, -2));

        levelMeter = new LevelMeter(this);
        panel.addView(levelMeter, new LinearLayout.LayoutParams(-1, dp(5)));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(Gravity.CENTER_VERTICAL);
        footer.setPadding(0, dp(9), 0, 0);
        profileButton = text(profileLabel(), 11, GOLD, Typeface.BOLD);
        profileButton.setGravity(Gravity.CENTER);
        profileButton.setPadding(dp(10), dp(6), dp(10), dp(6));
        profileButton.setBackground(shape(Color.rgb(34, 48, 70), 14, Color.TRANSPARENT, 0));
        profileButton.setOnClickListener(v -> cycleRoomProfile());
        footer.addView(profileButton, new LinearLayout.LayoutParams(-2, -2));

        fileProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        fileProgress.setMax(1000);
        fileProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(GOLD));
        fileProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(47, 62, 86)));
        fileProgress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(0, dp(3), 1);
        progressParams.leftMargin = dp(12);
        footer.addView(fileProgress, progressParams);
        panel.addView(footer);
        return panel;
    }

    private View buildProgressRow() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        progressView = text("01 / 17", 12, MUTED, Typeface.BOLD);
        progressView.setLetterSpacing(0.08f);
        row.addView(progressView, new LinearLayout.LayoutParams(0, -2, 1));

        displayButton = text(displayLabel(), 11, CREAM, Typeface.BOLD);
        displayButton.setGravity(Gravity.CENTER);
        displayButton.setPadding(dp(12), dp(7), dp(12), dp(7));
        displayButton.setBackground(shape(Color.rgb(23, 38, 62), 16, Color.rgb(45, 63, 90), 1));
        displayButton.setOnClickListener(v -> cycleDisplayMode());
        row.addView(displayButton, new LinearLayout.LayoutParams(-2, -2));
        return row;
    }

    private View buildBottomControls() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setPadding(dp(10), dp(10), dp(10), dp(8));
        shell.setBackground(shape(Color.rgb(11, 23, 41), 24, Color.rgb(35, 53, 79), 1));

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);

        TextView previous = roundControl("‹", "Previous prayer line", v -> moveManually(-1));
        controls.addView(previous, new LinearLayout.LayoutParams(dp(52), dp(52)));

        listenButton = text("LISTEN\nהאזן", 14, NAVY, Typeface.BOLD);
        listenButton.setGravity(Gravity.CENTER);
        listenButton.setLineSpacing(0, 0.86f);
        listenButton.setContentDescription("Start listening");
        listenButton.setBackground(gradient(Color.rgb(246, 218, 145), GOLD, GradientDrawable.Orientation.TL_BR, 30));
        listenButton.setElevation(dp(8));
        listenButton.setOnClickListener(v -> toggleLiveListening());
        LinearLayout.LayoutParams listenParams = new LinearLayout.LayoutParams(dp(124), dp(58));
        listenParams.leftMargin = dp(16);
        listenParams.rightMargin = dp(16);
        controls.addView(listenButton, listenParams);

        TextView next = roundControl("›", "Next prayer line", v -> moveManually(1));
        controls.addView(next, new LinearLayout.LayoutParams(dp(52), dp(52)));
        shell.addView(controls, new LinearLayout.LayoutParams(-1, -2));
        return shell;
    }

    private TextView roundControl(String label, String description, View.OnClickListener click) {
        TextView control = text(label, 34, CREAM, Typeface.NORMAL);
        control.setGravity(Gravity.CENTER);
        control.setContentDescription(description);
        control.setBackground(shape(PANEL_LIGHT, 26, Color.rgb(52, 70, 97), 1));
        control.setOnClickListener(click);
        return control;
    }

    private void loadPrayers() {
        lines.clear();
        List<PrayerLine> saved = PrayerRepository.decode(prefs.getString(KEY_PRAYERS, null));
        usingStarterText = saved.isEmpty();
        lines.addAll(saved.isEmpty() ? PrayerRepository.starterLines() : saved);
        currentIndex = Math.max(0, Math.min(currentIndex, lines.size() - 1));
        tracker.setLines(lines);
        tracker.setCurrentIndex(currentIndex);
        renderLines();
    }

    private void replacePrayers(List<PrayerLine> replacement) {
        if (replacement == null || replacement.isEmpty()) return;
        lines.clear();
        lines.addAll(replacement);
        currentIndex = 0;
        tracker.setLines(lines);
        tracker.setCurrentIndex(0);
        prefs.edit()
                .putString(KEY_PRAYERS, PrayerRepository.encode(lines))
                .putInt(KEY_INDEX, 0)
                .apply();
        renderLines();
    }

    private void renderLines() {
        linesContainer.removeAllViews();
        lineCards.clear();
        for (int i = 0; i < lines.size(); i++) {
            LineCard card = new LineCard(lines.get(i), i);
            lineCards.add(card);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
            params.bottomMargin = dp(8);
            linesContainer.addView(card.root, params);
        }
        updateCurrentLine(false);
        handler.post(() -> scrollToCurrent(false));
    }

    private void updateCurrentLine(boolean scroll) {
        tracker.setCurrentIndex(currentIndex);
        for (int i = 0; i < lineCards.size(); i++) lineCards.get(i).setState(i == currentIndex, i < currentIndex);
        progressView.setText(String.format(Locale.US, "%02d / %02d", currentIndex + 1, Math.max(1, lines.size())));
        if (scroll) scrollToCurrent(true);
    }

    private void scrollToCurrent(boolean smooth) {
        if (currentIndex < 0 || currentIndex >= lineCards.size()) return;
        View target = lineCards.get(currentIndex).root;
        handler.post(() -> {
            int y = Math.max(0, target.getTop() - dp(20));
            if (smooth) scrollView.smoothScrollTo(0, y); else scrollView.scrollTo(0, y);
        });
    }

    private void moveManually(int delta) {
        if (lines.isEmpty()) return;
        currentIndex = Math.max(0, Math.min(lines.size() - 1, currentIndex + delta));
        prefs.edit().putInt(KEY_INDEX, currentIndex).apply();
        tracker.clearContext();
        updateCurrentLine(true);
    }

    private void cycleDisplayMode() {
        if (displayMode == DisplayMode.BOTH) displayMode = DisplayMode.HEBREW;
        else if (displayMode == DisplayMode.HEBREW) displayMode = DisplayMode.ENGLISH;
        else displayMode = DisplayMode.BOTH;
        prefs.edit().putString(KEY_DISPLAY, displayMode.name()).apply();
        displayButton.setText(displayLabel());
        for (LineCard card : lineCards) card.applyDisplayMode();
    }

    private String displayLabel() {
        switch (displayMode) {
            case HEBREW: return "עברית";
            case ENGLISH: return "ENGLISH";
            case BOTH:
            default: return "HE  ·  EN";
        }
    }

    private void cycleRoomProfile() {
        if (roomProfile == TrackingEngine.RoomProfile.BALANCED) roomProfile = TrackingEngine.RoomProfile.REVERBERANT;
        else if (roomProfile == TrackingEngine.RoomProfile.REVERBERANT) roomProfile = TrackingEngine.RoomProfile.HARD_TO_HEAR;
        else roomProfile = TrackingEngine.RoomProfile.BALANCED;
        tracker.setRoomProfile(roomProfile);
        prefs.edit().putString(KEY_PROFILE, roomProfile.name()).apply();
        profileButton.setText(profileLabel());
        setStatus("Room profile updated · פרופיל החדר עודכן", GOLD);
    }

    private String profileLabel() {
        switch (roomProfile) {
            case BALANCED: return "BALANCED · מאוזן";
            case HARD_TO_HEAR: return "HARD TO HEAR · שמיעה קשה";
            case REVERBERANT:
            default: return "ECHO ROOM · חלל מהדהד";
        }
    }

    private void setupSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            setStatus("Hebrew speech service unavailable · אין שירות זיהוי דיבור", RED);
            listenButton.setEnabled(false);
            listenButton.setAlpha(0.45f);
            return;
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(this);
    }

    private Intent baseRecognitionIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "he-IL");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "he-IL");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 10);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,
                roomProfile == TrackingEngine.RoomProfile.BALANCED ? 1400L : 1800L);
        long completeSilence = roomProfile == TrackingEngine.RoomProfile.BALANCED ? 450L : 650L;
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, completeSilence);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                roomProfile == TrackingEngine.RoomProfile.BALANCED ? 300L : 420L);
        if (Build.VERSION.SDK_INT >= 33) {
            ArrayList<String> bias = new ArrayList<>();
            int from = Math.max(0, currentIndex - 2);
            int to = Math.min(lines.size(), currentIndex + 40);
            for (int i = from; i < to; i++) {
                String value = lines.get(i).hebrew;
                if (value.length() > 80) value = value.substring(0, 80);
                bias.add(value);
            }
            intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, bias);
        }
        return intent;
    }

    private void toggleLiveListening() {
        if (sessionMode != SessionMode.IDLE) {
            stopSession("Listening paused · ההאזנה נעצרה");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
            return;
        }
        startLiveListening();
    }

    private void startLiveListening() {
        if (recognizer == null) return;
        sessionMode = SessionMode.LIVE;
        tracker.clearContext();
        tracker.setAmbientNoise(0.24);
        tracker.setSignalContrast(0.30);
        chantAcoustics.reset();
        chantAcoustics.setMinimumQuietMs(roomProfile == TrackingEngine.RoomProfile.BALANCED ? 280 : 380);
        listeningStartedAt = System.currentTimeMillis();
        noiseFloor = 0.18f;
        peakLevel = 0.48f;
        consecutiveClientErrors = 0;
        listenButton.setText("STOP\nעצור");
        listenButton.setContentDescription("Stop listening");
        setStatus("Starting Hebrew listener · מפעיל האזנה בעברית", GOLD);
        safeStartLiveRecognizer();
    }

    private void safeStartLiveRecognizer() {
        if (sessionMode != SessionMode.LIVE || recognizer == null) return;
        try {
            recognizer.startListening(baseRecognitionIntent());
        } catch (Exception error) {
            scheduleRestart(900);
        }
    }

    private void scheduleRestart(long delayMs) {
        if (sessionMode != SessionMode.LIVE) return;
        handler.removeCallbacks(restartRecognizer);
        handler.postDelayed(restartRecognizer, delayMs);
    }

    private void stopSession(String message) {
        SessionMode previous = sessionMode;
        sessionMode = SessionMode.IDLE;
        newestRecognitionJob.incrementAndGet();
        handler.removeCallbacks(restartRecognizer);
        if (fileStreamer != null) {
            fileStreamer.cancel();
            fileStreamer = null;
        }
        closeRecognitionAudioDescriptor();
        if (recognizer != null) {
            try { recognizer.stopListening(); } catch (Exception ignored) {}
            try { recognizer.cancel(); } catch (Exception ignored) {}
        }
        listenButton.setText("LISTEN\nהאזן");
        listenButton.setContentDescription("Start listening");
        fileProgress.setVisibility(View.GONE);
        levelMeter.setLevel(0);
        if (previous != SessionMode.IDLE || message != null) setStatus(message, GOLD);
    }

    private void processRecognition(Bundle results, boolean partial) {
        if (results == null || sessionMode == SessionMode.IDLE) return;
        ArrayList<String> candidates = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        float[] confidences = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        if (candidates == null || candidates.isEmpty()) return;
        ArrayList<String> candidateCopy = new ArrayList<>(candidates);
        float[] confidenceCopy = confidences == null ? null : confidences.clone();

        if (sessionMode != SessionMode.LIVE) {
            applyRecognitionResult(tracker.accept(candidateCopy, confidenceCopy, partial));
            return;
        }

        long job = newestRecognitionJob.incrementAndGet();
        matcherExecutor.execute(() -> {
            // Drop superseded interim work before doing the expensive global comparison.
            if (partial && job != newestRecognitionJob.get()) return;
            TrackingEngine.Result result = tracker.accept(candidateCopy, confidenceCopy, partial);
            runOnUiThread(() -> {
                if (sessionMode != SessionMode.LIVE || job < lastAppliedRecognitionJob) return;
                lastAppliedRecognitionJob = job;
                applyRecognitionResult(result);
            });
        });
    }

    private void applyRecognitionResult(TrackingEngine.Result result) {
        if (!result.transcript.isEmpty()) {
            heardView.setText(String.format(Locale.getDefault(), "שמע: %s", result.transcript));
            heardView.setTextDirection(View.TEXT_DIRECTION_RTL);
        }
        if (result.moved) {
            currentIndex = result.index;
            prefs.edit().putInt(KEY_INDEX, currentIndex).apply();
            updateCurrentLine(true);
        }
        if (result.score > 0) {
            int percent = (int) Math.round(result.score * 100);
            if (result.awaitingConfirmation) {
                setStatus("Confirming location " + percent + "% · מאמת מיקום", GOLD);
            } else if (result.reanchored) {
                setStatus("Location found " + percent + "% · המיקום נמצא", GREEN);
            } else if (result.score >= 0.38) {
                setStatus("Following " + percent + "% · עוקב אחרי החזן", GREEN);
            }
        }
    }

    private void showRecordingAnalysisDialog() {
        Dialog dialog = createSheet("RECORDING CHECK · בדיקת הקלטה",
                "Development and troubleshooting tool: analyze audio from a recording or video without adding it to the app.");
        LinearLayout content = dialog.findViewById(R.id.sheet_content);
        content.addView(sheetButton("Choose audio or video · בחירת קובץ", v -> {
            dialog.dismiss();
            chooseMediaFile();
        }));
        content.addView(sheetButton("Close · סגור", v -> dialog.dismiss()));
        dialog.show();
    }

    private void chooseMediaFile() {
        if (Build.VERSION.SDK_INT < 33) {
            Toast.makeText(this, "File-to-recognizer tracking requires Android 13 or newer.", Toast.LENGTH_LONG).show();
            return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("*/*");
        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/*", "video/*"});
        try {
            startActivityForResult(picker, PICK_MEDIA);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No file picker is available on this device.", Toast.LENGTH_LONG).show();
        }
    }

    private void startFileTracking(Uri uri, String label) {
        if (Build.VERSION.SDK_INT < 33) {
            Toast.makeText(this, "Recording analysis requires Android 13 or newer.", Toast.LENGTH_LONG).show();
            return;
        }
        if (recognizer == null || sessionMode != SessionMode.IDLE) return;
        sessionMode = SessionMode.FILE;
        tracker.clearContext();
        tracker.setAmbientNoise(0.30);
        tracker.setSignalContrast(0.24);
        chantAcoustics.reset();
        chantAcoustics.setMinimumQuietMs(360);
        listenButton.setText("STOP\nעצור");
        fileProgress.setProgress(0);
        fileProgress.setVisibility(View.VISIBLE);
        setStatus("Preparing " + label + " · מכין קובץ שמע", GOLD);

        new Thread(() -> {
            try {
                AudioFileStreamer.Probe probe = AudioFileStreamer.probe(this, uri);
                ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
                recognitionAudioDescriptor = pipe[0];
                Intent intent = baseRecognitionIntent();
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, recognitionAudioDescriptor);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, probe.channelCount);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, probe.sampleRate);
                intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);

                fileStreamer = new AudioFileStreamer(this, uri, pipe[1], new AudioFileStreamer.Callback() {
                    @Override public void onProgress(long positionUs, long durationUs) {
                        if (durationUs <= 0) return;
                        int progress = (int) Math.min(1000, (positionUs * 1000L) / durationUs);
                        runOnUiThread(() -> fileProgress.setProgress(progress));
                    }

                    @Override public void onComplete() {
                        runOnUiThread(() -> setStatus("Finishing transcription · מסיים תמלול", GOLD));
                    }

                    @Override public void onError(Exception error) {
                        runOnUiThread(() -> stopSession("Could not decode file · לא ניתן לפענח את הקובץ"));
                    }
                });
                runOnUiThread(() -> {
                    if (sessionMode != SessionMode.FILE) {
                        fileStreamer.cancel();
                        return;
                    }
                    startFileRecognizerWhenSupported(intent);
                });
            } catch (Exception error) {
                runOnUiThread(() -> stopSession("No usable audio track · לא נמצאה רצועת שמע"));
            }
        }, "selichot-file-probe").start();
    }

    private void startFileRecognizerWhenSupported(Intent intent) {
        if (Build.VERSION.SDK_INT < 33 || recognizer == null || sessionMode != SessionMode.FILE) return;
        setStatus("Checking speech-service audio support · בודק תמיכת שירות", GOLD);
        try {
            recognizer.checkRecognitionSupport(intent, getMainExecutor(), new RecognitionSupportCallback() {
                @Override public void onSupportResult(RecognitionSupport support) {
                    if (sessionMode != SessionMode.FILE || fileStreamer == null) return;
                    try {
                        recognizer.startListening(intent);
                        fileStreamer.start();
                        setStatus("Tracking recorded service · עוקב אחרי ההקלטה", GREEN);
                    } catch (Exception error) {
                        stopSession("Recognizer rejected this audio source · שירות הזיהוי דחה את הקובץ");
                    }
                }

                @Override public void onError(int error) {
                    stopSession("Speech service cannot read audio files · שירות הזיהוי אינו תומך בקבצים");
                }
            });
        } catch (Exception error) {
            stopSession("Could not verify audio-file support · לא ניתן לאמת תמיכה בקובץ");
        }
    }

    private void showSettingsDialog() {
        Dialog dialog = createSheet("SETTINGS · הגדרות", "Tune the room, prayer text, and display.");
        LinearLayout content = dialog.findViewById(R.id.sheet_content);
        content.addView(sheetButton("Room: " + profileLabel(), v -> {
            cycleRoomProfile();
            dialog.dismiss();
        }));
        content.addView(sheetButton("Display: " + displayLabel(), v -> {
            cycleDisplayMode();
            dialog.dismiss();
        }));
        content.addView(sheetButton("Analyze a recording · בדיקת הקלטה", v -> {
            dialog.dismiss();
            showRecordingAnalysisDialog();
        }));
        content.addView(sheetButton("Download full Sephardic text · הורדת נוסח", v -> {
            dialog.dismiss();
            downloadFromSefaria();
        }));
        content.addView(sheetButton("Edit Hebrew prayer text · עריכת נוסח", v -> {
            dialog.dismiss();
            showEditDialog();
        }));
        content.addView(sheetButton("Restore starter text · שחזור נוסח בסיסי", v -> {
            dialog.dismiss();
            confirmRestoreStarter();
        }));
        content.addView(sheetButton("Speech service settings · הגדרות זיהוי", v -> {
            dialog.dismiss();
            try { startActivity(new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)); }
            catch (Exception ignored) { Toast.makeText(this, "Voice settings are unavailable.", Toast.LENGTH_LONG).show(); }
        }));
        content.addView(sheetButton("Close · סגור", v -> dialog.dismiss()));
        dialog.show();
    }

    private Dialog createSheet(String title, String subtitle) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout panel = new LinearLayout(this);
        panel.setId(R.id.sheet_content);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(22), dp(22), dp(22), dp(18));
        panel.setBackground(shape(PANEL, 26, Color.rgb(52, 70, 97), 1));
        TextView heading = text(title, 18, CREAM, Typeface.BOLD);
        heading.setLetterSpacing(0.04f);
        panel.addView(heading, withBottomMargin(new LinearLayout.LayoutParams(-1, -2), 5));
        TextView detail = text(subtitle, 13, MUTED, Typeface.NORMAL);
        panel.addView(detail, withBottomMargin(new LinearLayout.LayoutParams(-1, -2), 14));
        scroll.addView(panel);
        dialog.setContentView(scroll);
        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window != null) {
                window.setBackgroundDrawableResource(android.R.color.transparent);
                window.setLayout((int) (getResources().getDisplayMetrics().widthPixels * 0.92f), -2);
                window.setGravity(Gravity.CENTER);
            }
        });
        return dialog;
    }

    private TextView sheetButton(String label, View.OnClickListener listener) {
        TextView button = text(label, 14, CREAM, Typeface.BOLD);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setPadding(dp(14), dp(13), dp(14), dp(13));
        button.setBackground(shape(PANEL_LIGHT, 14, Color.rgb(52, 70, 97), 1));
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(8);
        button.setLayoutParams(params);
        return button;
    }

    private void showEditDialog() {
        EditText input = new EditText(this);
        input.setText(PrayerRepository.hebrewForEditor(lines));
        input.setTextColor(Color.BLACK);
        input.setTextSize(18);
        input.setGravity(Gravity.TOP | Gravity.END);
        input.setTextDirection(View.TEXT_DIRECTION_RTL);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setMinLines(12);
        input.setPadding(dp(16), dp(12), dp(16), dp(12));
        input.setBackground(shape(Color.WHITE, 12, Color.rgb(210, 214, 220), 1));
        new AlertDialog.Builder(this)
                .setTitle("Edit Hebrew text · עריכת נוסח")
                .setMessage("Use one trackable phrase per line. Custom lines will not have English translations.")
                .setView(input)
                .setPositiveButton("Save · שמור", (dialog, which) -> {
                    List<PrayerLine> edited = PrayerRepository.fromHebrewEditor(input.getText().toString());
                    if (!edited.isEmpty()) replacePrayers(edited);
                })
                .setNegativeButton("Cancel · ביטול", null)
                .show();
    }

    private void confirmRestoreStarter() {
        new AlertDialog.Builder(this)
                .setTitle("Restore starter text?")
                .setMessage("This replaces the current prayer text and returns to the beginning.")
                .setPositiveButton("Restore", (dialog, which) -> replacePrayers(PrayerRepository.starterLines()))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void downloadFromSefaria() {
        downloadFromSefaria(true);
    }

    private void downloadFromSefaria(boolean userInitiated) {
        setStatus(userInitiated
                ? "Downloading bilingual Sephardic text · מוריד נוסח דו־לשוני"
                : "Preparing the full service · מכין את הנוסח המלא", GOLD);
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL("https://www.sefaria.org/api/texts/Selichot_Edot_HaMizrach?pad=0&commentary=0");
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("User-Agent", "SelichotFollow/2.0 Android");
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        connection.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder json = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) json.append(line);
                reader.close();
                List<PrayerLine> downloaded = PrayerRepository.fromSefaria(new JSONObject(json.toString()));
                if (downloaded.size() < 20) throw new IllegalStateException("Not enough segments");
                runOnUiThread(() -> {
                    usingStarterText = false;
                    replacePrayers(downloaded);
                    setStatus("Full text ready · הנוסח המלא מוכן", GREEN);
                    if (userInitiated) {
                        Toast.makeText(this, downloaded.size() + " bilingual prayer segments downloaded", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setStatus(userInitiated
                            ? "Download failed; current text kept · ההורדה נכשלה"
                            : "Starter text ready; full text is in Settings · נוסח בסיסי מוכן",
                            userInitiated ? RED : GOLD);
                    if (userInitiated) {
                        Toast.makeText(this, "Check the internet connection and try again.", Toast.LENGTH_LONG).show();
                    }
                });
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "selichot-download").start();
    }

    private void setStatus(String message, int dotColor) {
        statusView.setText(message == null ? "" : message);
        statusDot.setTextColor(dotColor);
    }

    private void recreateRecognizer() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(this);
    }

    private String errorLabel(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "Audio capture error · שגיאת שמע";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission needed · נדרשת הרשאת מיקרופון";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Speech network unavailable · אין חיבור לזיהוי";
            case SpeechRecognizer.ERROR_SERVER: return "Speech service unavailable · שירות הזיהוי לא זמין";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Listener is busy; retrying · מנסה שוב";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "Speech service is cooling down · ממתין לשירות";
            default: return "Listening for the next phrase · מאזין לקטע הבא";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_MEDIA && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception ignored) {}
            startFileTracking(uri, "selected recording");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MIC_PERMISSION) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startLiveListening();
        } else {
            setStatus("Microphone permission is required · נדרשת הרשאת מיקרופון", RED);
            Toast.makeText(this, "Allow microphone access so the app can follow the service.", Toast.LENGTH_LONG).show();
        }
    }

    @Override public void onReadyForSpeech(Bundle params) {
        setStatus(sessionMode == SessionMode.FILE
                ? "Reading recording · קורא את ההקלטה"
                : "Listening for Hebrew · מאזין לעברית", GREEN);
    }

    @Override public void onBeginningOfSpeech() {
        setStatus("Hebrew speech detected · זוהה דיבור בעברית", GREEN);
    }

    @Override public void onRmsChanged(float rmsdB) {
        float level = Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f));
        levelMeter.setLevel(level);
        ChantAcousticTracker.Event acousticEvent = chantAcoustics.acceptLevel(
                level, System.currentTimeMillis());
        if (acousticEvent.phraseBoundary) {
            tracker.noteAcousticBoundary(acousticEvent.strength);
        }
        if (sessionMode == SessionMode.LIVE) {
            long elapsed = System.currentTimeMillis() - listeningStartedAt;
            float smoothing = elapsed < 5000 ? 0.14f : 0.025f;
            if (level < noiseFloor + 0.12f) noiseFloor += (level - noiseFloor) * smoothing;
            peakLevel = Math.max(level, peakLevel * 0.994f);
            tracker.setAmbientNoise(Math.max(0, Math.min(1, noiseFloor * 1.35)));
            tracker.setSignalContrast(Math.max(0, Math.min(1, peakLevel - noiseFloor)));
        }
    }

    @Override public void onBufferReceived(byte[] buffer) {
        // Optional across recognition providers. It improves chant-boundary confidence when
        // PCM is exposed; recognition still works from RMS callbacks when it is not.
        chantAcoustics.observePcm16(buffer, 16000);
    }
    @Override public void onEndOfSpeech() {
        if (sessionMode != SessionMode.IDLE) setStatus("Matching the prayer · מתאים את התפילה", GOLD);
    }

    @Override
    public void onError(int error) {
        if (sessionMode == SessionMode.IDLE) return;
        setStatus(errorLabel(error), error == SpeechRecognizer.ERROR_NO_MATCH ? GOLD : RED);
        if (sessionMode == SessionMode.FILE) {
            stopSession("File recognition ended · זיהוי הקובץ הסתיים");
            return;
        }
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            stopSession(errorLabel(error));
            return;
        }
        if (error == SpeechRecognizer.ERROR_CLIENT) {
            consecutiveClientErrors++;
            if (consecutiveClientErrors >= 2) recreateRecognizer();
        } else {
            consecutiveClientErrors = 0;
        }
        long delay;
        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) delay = 1100;
        else if (error == SpeechRecognizer.ERROR_TOO_MANY_REQUESTS) delay = 2600;
        else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) delay = 1400;
        else delay = 240;
        scheduleRestart(delay);
    }

    @Override
    public void onResults(Bundle results) {
        processRecognition(results, false);
        if (sessionMode == SessionMode.LIVE) scheduleRestart(140);
        else if (sessionMode == SessionMode.FILE) stopSession("Recording analysis complete · ניתוח ההקלטה הושלם");
    }

    @Override public void onPartialResults(Bundle partialResults) {
        processRecognition(partialResults, true);
    }

    @Override public void onSegmentResults(Bundle segmentResults) {
        processRecognition(segmentResults, false);
    }

    @Override public void onEndOfSegmentedSession() {
        if (sessionMode == SessionMode.FILE) stopSession("Recording analysis complete · ניתוח ההקלטה הושלם");
    }

    @Override public void onEvent(int eventType, Bundle params) {}

    @Override
    protected void onDestroy() {
        stopSession(null);
        matcherExecutor.shutdownNow();
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        super.onDestroy();
    }

    private void closeRecognitionAudioDescriptor() {
        if (recognitionAudioDescriptor != null) {
            try { recognitionAudioDescriptor.close(); } catch (Exception ignored) {}
            recognitionAudioDescriptor = null;
        }
    }

    private TextView text(String value, float size, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        view.setIncludeFontPadding(false);
        return view;
    }

    private GradientDrawable shape(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), strokeColor);
        return drawable;
    }

    private GradientDrawable gradient(int start, int end, GradientDrawable.Orientation orientation, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable(orientation, new int[]{start, end});
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private LinearLayout.LayoutParams withBottomMargin(LinearLayout.LayoutParams params, int marginDp) {
        params.bottomMargin = dp(marginDp);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private final class LineCard {
        final LinearLayout root;
        final TextView number;
        final TextView hebrew;
        final TextView english;

        LineCard(PrayerLine line, int index) {
            root = new LinearLayout(MainActivity.this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(dp(15), dp(13), dp(15), dp(14));
            root.setOnClickListener(v -> {
                currentIndex = index;
                prefs.edit().putInt(KEY_INDEX, currentIndex).apply();
                tracker.clearContext();
                updateCurrentLine(false);
            });

            number = text(String.format(Locale.US, "%02d", index + 1), 10, GOLD, Typeface.BOLD);
            number.setLetterSpacing(0.12f);
            root.addView(number, withBottomMargin(new LinearLayout.LayoutParams(-1, -2), 5));

            hebrew = text(line.hebrew, 24, CREAM, Typeface.NORMAL);
            hebrew.setTypeface(Typeface.create("serif", Typeface.NORMAL));
            hebrew.setTextDirection(View.TEXT_DIRECTION_RTL);
            hebrew.setGravity(Gravity.END);
            hebrew.setLineSpacing(dp(3), 1f);
            root.addView(hebrew, new LinearLayout.LayoutParams(-1, -2));

            english = text(line.english.isEmpty() ? "Translation unavailable for this custom line" : line.english,
                    13, MUTED, Typeface.NORMAL);
            english.setLineSpacing(dp(2), 1f);
            english.setPadding(0, dp(7), 0, 0);
            root.addView(english, new LinearLayout.LayoutParams(-1, -2));
            applyDisplayMode();
        }

        void applyDisplayMode() {
            hebrew.setVisibility(displayMode == DisplayMode.ENGLISH ? View.GONE : View.VISIBLE);
            english.setVisibility(displayMode == DisplayMode.HEBREW ? View.GONE : View.VISIBLE);
        }

        void setState(boolean current, boolean passed) {
            if (current) {
                root.setBackground(gradient(Color.rgb(27, 47, 78), Color.rgb(20, 38, 66),
                        GradientDrawable.Orientation.TL_BR, 18));
                GradientDrawable background = (GradientDrawable) root.getBackground();
                background.setStroke(dp(1), GOLD);
                root.setElevation(dp(4));
                root.setAlpha(1f);
                number.setTextColor(GOLD);
                hebrew.setTextColor(Color.WHITE);
                english.setTextColor(Color.rgb(205, 215, 228));
            } else {
                root.setBackground(shape(Color.rgb(13, 26, 46), 16, Color.rgb(31, 48, 73), 1));
                root.setElevation(0);
                root.setAlpha(passed ? 0.55f : 0.84f);
                number.setTextColor(MUTED);
                hebrew.setTextColor(CREAM);
                english.setTextColor(MUTED);
            }
        }
    }

    private static final class LevelMeter extends View {
        private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint levelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float level;

        LevelMeter(Activity context) {
            super(context);
            backgroundPaint.setColor(Color.rgb(45, 61, 85));
            levelPaint.setColor(GREEN);
        }

        void setLevel(float value) {
            level += (Math.max(0, Math.min(1, value)) - level) * 0.42f;
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float radius = getHeight() / 2f;
            canvas.drawRoundRect(0, 0, getWidth(), getHeight(), radius, radius, backgroundPaint);
            canvas.drawRoundRect(0, 0, Math.max(getHeight(), getWidth() * level), getHeight(), radius, radius, levelPaint);
        }
    }
}
