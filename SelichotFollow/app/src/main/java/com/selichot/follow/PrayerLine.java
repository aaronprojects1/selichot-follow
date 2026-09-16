package com.selichot.follow;

final class PrayerLine {
    final String hebrew;
    final String english;

    PrayerLine(String hebrew, String english) {
        this.hebrew = hebrew == null ? "" : hebrew.trim();
        this.english = english == null ? "" : english.trim();
    }
}
