package com.selichot.follow;

import android.text.Html;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class PrayerRepository {
    private PrayerRepository() {}

    static List<PrayerLine> starterLines() {
        List<PrayerLine> lines = new ArrayList<>();
        add(lines, "בן אדם מה לך נרדם, קום קרא בתחנונים", "Child of humanity, why do you sleep? Rise and call out with supplications.");
        add(lines, "שפוך שיחה, דרוש סליחה, מאדון האדונים", "Pour out your words; seek forgiveness from the Master of masters.");
        add(lines, "רחץ וטהר ואל תאחר, בטרם ימים פונים", "Wash and purify yourself; do not delay before the days turn away.");
        add(lines, "ומהרה רוץ לעזרה, לפני שוכן מעונים", "Hurry and run for help before the One who dwells on high.");
        add(lines, "ומפשע וגם רשע, ברח ופחד מאסונים", "Flee transgression and wrongdoing, and fear their consequences.");
        add(lines, "אנא שעה שמך יודעי, ישראל נאמנים", "Please turn toward those who know Your name—faithful Israel.");
        add(lines, "לך אדני הצדקה, ולנו בושת הפנים", "Righteousness is Yours, Lord; shame is ours.");
        add(lines, "אל מלך יושב על כסא רחמים", "God and King, seated upon the throne of mercy.");
        add(lines, "מתנהג בחסידות, מוחל עוונות עמו", "Acting with lovingkindness, forgiving the sins of His people.");
        add(lines, "מעביר ראשון ראשון, מרבה מחילה לחטאים", "Removing each sin in turn, abundant in forgiveness for sinners.");
        add(lines, "וסליחה לפושעים, עושה צדקות עם כל בשר ורוח", "Granting pardon to transgressors, doing righteousness with every living being.");
        add(lines, "לא כרעתם גומל להם", "Not repaying them according to their wrongdoing.");
        add(lines, "אל הורית לנו לומר שלש עשרה", "God, You taught us to recite the Thirteen Attributes.");
        add(lines, "זכור לנו היום ברית שלש עשרה", "Remember for us today the covenant of the Thirteen Attributes.");
        add(lines, "ויעבור ה׳ על פניו ויקרא", "The Lord passed before him and proclaimed.");
        add(lines, "ה׳ ה׳ אל רחום וחנון, ארך אפים ורב חסד ואמת", "The Lord, the Lord—compassionate and gracious, slow to anger, abundant in kindness and truth.");
        add(lines, "נוצר חסד לאלפים, נושא עון ופשע וחטאה ונקה", "Preserving kindness for thousands, forgiving iniquity, transgression, and sin, and cleansing.");
        return lines;
    }

    static String encode(List<PrayerLine> lines) {
        JSONArray array = new JSONArray();
        for (PrayerLine line : lines) {
            JSONObject item = new JSONObject();
            try {
                item.put("he", line.hebrew);
                item.put("en", line.english);
                array.put(item);
            } catch (JSONException ignored) {
                // JSONObject backed by in-memory strings should not fail here.
            }
        }
        return array.toString();
    }

    static List<PrayerLine> decode(String json) {
        List<PrayerLine> out = new ArrayList<>();
        if (json == null || json.trim().isEmpty()) return out;
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item == null) continue;
                PrayerLine line = new PrayerLine(item.optString("he"), item.optString("en"));
                if (!line.hebrew.isEmpty()) out.add(line);
            }
            return out;
        } catch (JSONException ignored) {
            // Migrate the version-1 newline format. Corrupted mojibake is intentionally discarded.
            if (json.contains("×")) return out;
            for (String raw : json.replace("\r", "").split("\n")) {
                String line = raw.trim();
                if (!line.isEmpty()) out.add(new PrayerLine(line, ""));
            }
            return out;
        }
    }

    static List<PrayerLine> fromSefaria(JSONObject root) throws JSONException {
        List<PrayerLine> raw = new ArrayList<>();
        flattenParallel(root.opt("he"), root.opt("text"), raw);
        List<PrayerLine> trackable = new ArrayList<>();
        for (PrayerLine segment : raw) trackable.addAll(splitParallel(segment));
        return trackable;
    }

    static List<PrayerLine> fromHebrewEditor(String text) {
        List<PrayerLine> out = new ArrayList<>();
        if (text == null) return out;
        for (String raw : text.replace("\r", "").split("\n")) {
            String line = raw.trim();
            if (!line.isEmpty()) out.add(new PrayerLine(line, ""));
        }
        return out;
    }

    static String hebrewForEditor(List<PrayerLine> lines) {
        StringBuilder out = new StringBuilder();
        for (PrayerLine line : lines) {
            if (out.length() > 0) out.append('\n');
            out.append(line.hebrew);
        }
        return out.toString();
    }

    private static void flattenParallel(Object hebrew, Object english, List<PrayerLine> out) throws JSONException {
        if (hebrew == null || hebrew == JSONObject.NULL) return;
        if (hebrew instanceof String) {
            String he = stripHtml((String) hebrew);
            String en = english instanceof String ? stripHtml((String) english) : "";
            if (!he.isEmpty()) out.add(new PrayerLine(he, en));
            return;
        }
        if (hebrew instanceof JSONArray) {
            JSONArray heArray = (JSONArray) hebrew;
            JSONArray enArray = english instanceof JSONArray ? (JSONArray) english : null;
            for (int i = 0; i < heArray.length(); i++) {
                Object heChild = heArray.opt(i);
                Object enChild = enArray != null && i < enArray.length() ? enArray.opt(i) : null;
                flattenParallel(heChild, enChild, out);
            }
        }
    }

    private static List<PrayerLine> splitParallel(PrayerLine source) {
        List<String> hebrew = splitTrackable(source.hebrew, true);
        List<String> english = splitTrackable(source.english, false);
        List<PrayerLine> out = new ArrayList<>();
        if (hebrew.isEmpty()) return out;
        for (int i = 0; i < hebrew.size(); i++) {
            String en = "";
            if (!english.isEmpty()) {
                int mapped = Math.min(english.size() - 1, (int) Math.floor((double) i * english.size() / hebrew.size()));
                en = english.get(mapped);
            }
            out.add(new PrayerLine(hebrew.get(i), en));
        }
        return out;
    }

    private static List<String> splitTrackable(String text, boolean hebrew) {
        List<String> out = new ArrayList<>();
        if (text == null || text.trim().isEmpty()) return out;
        String cleaned = text.replace('\r', ' ').replace('\n', ' ').replaceAll("\\s+", " ").trim();
        String punctuation = hebrew ? "(?<=[.:;!?׃])\\s+" : "(?<=[.!?;:])\\s+";
        String[] sentences = cleaned.split(punctuation);
        int softLimit = hebrew ? 105 : 165;
        int minimum = hebrew ? 32 : 45;
        for (String sentence : sentences) {
            String value = sentence.trim();
            if (value.isEmpty()) continue;
            if (value.length() <= softLimit) {
                out.add(value);
                continue;
            }
            StringBuilder chunk = new StringBuilder();
            for (String word : value.split(" ")) {
                if (chunk.length() + word.length() + 1 > softLimit && chunk.length() >= minimum) {
                    out.add(chunk.toString());
                    chunk.setLength(0);
                }
                if (chunk.length() > 0) chunk.append(' ');
                chunk.append(word);
            }
            if (chunk.length() > 0) out.add(chunk.toString());
        }
        return out;
    }

    private static String stripHtml(String value) {
        return Html.fromHtml(value == null ? "" : value, Html.FROM_HTML_MODE_LEGACY).toString().trim();
    }

    private static void add(List<PrayerLine> lines, String hebrew, String english) {
        lines.add(new PrayerLine(hebrew, english));
    }
}
